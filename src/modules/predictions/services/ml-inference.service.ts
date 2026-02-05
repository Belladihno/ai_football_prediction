import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ort from 'onnxruntime-node';
import * as path from 'path';
import * as fs from 'fs';

export interface InferenceResult {
  probabilities: number[]; // [homeWin, draw, awayWin]
  predictedClass: number; // 0=HOME, 1=DRAW, 2=AWAY
  confidence: number;
  modelName: string;
}

export interface EnsembleResult {
  probabilities: number[];
  predictedClass: number;
  confidence: number;
  modelContributions: { [model: string]: number[] };
  bestModel: string;
}

@Injectable()
export class MLInferenceService implements OnModuleInit {
  private readonly logger = new Logger(MLInferenceService.name);
  
  // ONNX sessions
  private sessions: Map<string, ort.InferenceSession> = new Map();
  private modelPaths: Map<string, string> = new Map();
  private probabilityOutputNames: Map<string, string> = new Map();
  private onnxOutputModes: Map<string, 'probabilities' | 'label'> = new Map();
  private modelsLoaded = false;

  // XGBoost JSON model (native format)
  private xgbModel: any = null;
  private xgbMetadata: any = null;

  // Model weights for ensemble
  private readonly ensembleWeights = {
    xgboost: 0.5,
    logistic: 0.25,
    random_forest: 0.25,
  };

  async onModuleInit() {
    await this.loadAllModels();
  }

  /**
   * Load all ONNX models and XGBoost JSON model
   */
  async loadAllModels(): Promise<void> {
    const modelsDir = path.join(process.cwd(), 'ml', 'models');
    const fallbackDir = path.join(process.cwd(), 'models');

    const onnxModels = [
      { name: 'logistic', file: 'logistic_v1.onnx' },
      { name: 'random_forest', file: 'random_forest_v1.onnx' },
    ];

    // Load ONNX models
    for (const model of onnxModels) {
      const modelPath = this.findModelPath(modelsDir, fallbackDir, model.file);
      if (modelPath) {
        await this.loadOnnxModel(model.name, modelPath);
      }
    }

    // Load XGBoost JSON model
    const xgbPath = this.findModelPath(modelsDir, fallbackDir, 'xgboost_v1.json');
    if (xgbPath) {
      await this.loadXgboostModel(xgbPath);
    }

    // Also check for xgboost_v1_xgboost.json
    const xgbAltPath = this.findModelPath(modelsDir, fallbackDir, 'xgboost_v1_xgboost.json');
    if (xgbAltPath && !this.xgbModel) {
      await this.loadXgboostModel(xgbAltPath);
    }

    this.modelsLoaded = this.sessions.size > 0 || this.xgbModel !== null;
    
    if (this.modelsLoaded) {
      this.logger.log(`Loaded ${this.sessions.size} ONNX models and ${this.xgbModel ? 1 : 0} XGBoost model`);
      this.logger.log(`Available models: ${Array.from(this.sessions.keys()).join(', ')}${this.xgbModel ? ', xgboost' : ''}`);
    } else {
      this.logger.warn('No models loaded - prediction service will fail');
    }
  }

  /**
   * Find model file in possible locations
   */
  private findModelPath(...paths: string[]): string | null {
    for (const baseDir of paths) {
      if (!fs.existsSync(baseDir)) continue;
      
      const files = fs.readdirSync(baseDir);
      for (const file of paths.flat()) {
        if (files.includes(file)) {
          return path.join(baseDir, file);
        }
      }
    }
    return null;
  }

  /**
   * Load ONNX model
   */
  private async loadOnnxModel(name: string, modelPath: string): Promise<void> {
    try {
      this.logger.log(`Loading ONNX model: ${name} from ${modelPath}`);
      const session = await ort.InferenceSession.create(modelPath);
      const selectedOutput = this.selectOnnxOutput(session);
      if (!selectedOutput) {
        this.logger.warn(
          `Skipping ONNX model ${name}: no tensor probability output found (outputNames=${session.outputNames.join(', ')})`,
        );
        return;
      }

      this.sessions.set(name, session);
      this.modelPaths.set(name, modelPath);
      this.probabilityOutputNames.set(name, selectedOutput.name);
      this.onnxOutputModes.set(name, selectedOutput.mode);
      this.logger.log(
        `✓ ${name} loaded - Input: ${session.inputNames}, Output: ${session.outputNames}, SelectedOutput: ${selectedOutput.name} (${selectedOutput.mode})`,
      );
    } catch (error) {
      this.logger.error(`Failed to load ${name}: ${error.message}`);
    }
  }

  private selectOnnxOutput(
    session: ort.InferenceSession,
  ): { name: string; mode: 'probabilities' | 'label' } | null {
    const outputs = Array.isArray((session as any).outputMetadata) ? ((session as any).outputMetadata as any[]) : [];

    const tensorOutputs = outputs.filter(o => Boolean(o?.isTensor));

    const floatTensorOutputs = tensorOutputs.filter(o => o?.type === 'float32' || o?.type === 'float64');
    const withThreeClasses = floatTensorOutputs.find(o =>
      Array.isArray(o?.shape) && o.shape.some((dim: unknown) => dim === 3),
    );
    if (withThreeClasses?.name) {
      return { name: withThreeClasses.name, mode: 'probabilities' };
    }

    if (floatTensorOutputs[0]?.name) {
      return { name: floatTensorOutputs[0].name, mode: 'probabilities' };
    }

    const intLabelOutput = tensorOutputs.find(o => o?.type === 'int64' || o?.type === 'int32');
    if (intLabelOutput?.name) {
      return { name: intLabelOutput.name, mode: 'label' };
    }

    return null;
  }

  /**
   * Load XGBoost JSON model
   */
  private async loadXgboostModel(modelPath: string): Promise<void> {
    try {
      this.logger.log(`Loading XGBoost JSON model from ${modelPath}`);
      const modelData = fs.readFileSync(modelPath, 'utf-8');
      this.xgbModel = JSON.parse(modelData);

      // Load metadata if exists
      const metadataPath = modelPath.replace('.json', '_metadata.json');
      if (fs.existsSync(metadataPath)) {
        const metadataData = fs.readFileSync(metadataPath, 'utf-8');
        this.xgbMetadata = JSON.parse(metadataData);
      }

      this.logger.log(`✓ XGBoost model loaded - ${this.xgbModel.n_estimators || 'unknown'} estimators`);
    } catch (error) {
      this.logger.error(`Failed to load XGBoost model: ${error.message}`);
    }
  }

  /**
   * Check if models are loaded
   */
  areModelsLoaded(): boolean {
    return this.modelsLoaded;
  }

  /**
   * Get all available model names
   */
  getAvailableModels(): string[] {
    const models: string[] = Array.from(this.sessions.keys());
    if (this.xgbModel) models.push('xgboost');
    return models;
  }

  /**
   * Run inference on a single ONNX model
   */
  async predictWithModel(modelName: string, features: number[]): Promise<InferenceResult> {
    const session = this.sessions.get(modelName);
    if (!session) {
      throw new Error(`Model ${modelName} not loaded`);
    }

    try {
      const float32Data = Float32Array.from(features);
      const inputTensor = new ort.Tensor('float32', float32Data, [1, features.length]);

      const inputName = session.inputNames[0];
      const feeds: Record<string, ort.Tensor> = {};
      feeds[inputName] = inputTensor;

      const probabilityOutputName = this.probabilityOutputNames.get(modelName);
      if (!probabilityOutputName) {
        throw new Error(`Model ${modelName} has no supported tensor probability output`);
      }

      const results = await session.run(feeds, [probabilityOutputName]);

      // Get output - try different output names
      const outputTensor = results[probabilityOutputName] as ort.Tensor;

      const mode = this.onnxOutputModes.get(modelName) || 'probabilities';

      let probabilities: number[];
      if (mode === 'label') {
        const label = this.extractLabel(outputTensor.data);
        probabilities = this.labelToProbabilities(label);
      } else {
        probabilities = this.extractProbabilities(outputTensor.data);
      }

      // Ensure probabilities sum to 1
      const sum = probabilities.reduce((a, b) => a + b, 0);
      if (sum > 0) {
        probabilities = probabilities.map(p => p / sum);
      }

      const predictedClass = probabilities.indexOf(Math.max(...probabilities));
      const confidence = Math.max(...probabilities);

      return {
        probabilities,
        predictedClass,
        confidence,
        modelName,
      };
    } catch (error) {
      this.logger.error(`Inference failed for ${modelName}: ${error.message}`);
      throw error;
    }
  }

  private extractLabel(data: any): number {
    if (typeof data === 'number') return data;
    if (typeof data === 'bigint') return Number(data);
    if (data && typeof data[0] === 'number') return Number(data[0]);
    if (data && typeof data[0] === 'bigint') return Number(data[0]);
    return 0;
  }

  private labelToProbabilities(label: number): number[] {
    const base = [0.15, 0.15, 0.15];
    const idx = label >= 0 && label <= 2 ? label : 0;
    base[idx] = 0.7;
    return base;
  }

  /**
   * Run XGBoost inference using JSON model
   */
  async predictWithXgboost(features: number[]): Promise<InferenceResult> {
    if (!this.xgbModel) {
      throw new Error('XGBoost model not loaded');
    }

    try {
      const gbtreeModel = this.xgbModel?.learner?.gradient_booster?.model;
      const trees: any[] | undefined = gbtreeModel?.trees;
      const treeInfo: number[] | undefined = gbtreeModel?.tree_info;

      if (!Array.isArray(trees) || !Array.isArray(treeInfo) || trees.length !== treeInfo.length) {
        throw new Error('Invalid XGBoost model format (missing trees/tree_info)');
      }

      const scores = [0, 0, 0];

      for (let treeIndex = 0; treeIndex < trees.length; treeIndex++) {
        const klass = treeInfo[treeIndex];
        if (klass !== 0 && klass !== 1 && klass !== 2) continue;

        const leafValue = this.evaluateXgboostTree(trees[treeIndex], features);
        scores[klass] += leafValue;
      }

      const probabilities = this.softmax(scores);

      const predictedClass = probabilities.indexOf(Math.max(...probabilities));
      const confidence = Math.max(...probabilities);

      return {
        probabilities,
        predictedClass,
        confidence,
        modelName: 'xgboost',
      };
    } catch (error) {
      this.logger.error(`XGBoost inference failed: ${error.message}`);
      throw error;
    }
  }

  private evaluateXgboostTree(tree: any, features: number[]): number {
    let node = 0;

    const left = tree.left_children;
    const right = tree.right_children;
    const splitIndices = tree.split_indices;
    const splitConditions = tree.split_conditions;
    const defaultLeft = tree.default_left;
    const baseWeights = tree.base_weights;

    const maxSteps = 10000;
    let steps = 0;

    while (steps++ < maxSteps) {
      const l = left?.[node];
      const r = right?.[node];

      if (l === -1 && r === -1) {
        return Number(baseWeights?.[node] ?? 0);
      }

      const featureIndex = splitIndices?.[node];
      const threshold = splitConditions?.[node];
      const value = typeof featureIndex === 'number' ? features[featureIndex] : undefined;

      let goLeft: boolean;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        goLeft = Boolean(defaultLeft?.[node]);
      } else {
        goLeft = value < threshold;
      }

      node = goLeft ? l : r;
      if (typeof node !== 'number' || node < 0) {
        return 0;
      }
    }

    return 0;
  }

  private softmax(scores: number[]): number[] {
    const max = Math.max(...scores);
    const exps = scores.map(s => Math.exp(s - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    if (sum === 0) return [0.33, 0.34, 0.33];
    return exps.map(e => e / sum);
  }

  /**
   * Run ensemble prediction - combine all models
   */
  async predictEnsemble(features: number[]): Promise<EnsembleResult> {
    const contributions: { [model: string]: number[] } = {};
    const availableModels = this.getAvailableModels();

    if (availableModels.length === 0) {
      throw new Error('No models available for ensemble prediction');
    }

    // Get predictions from each model
    for (const modelName of availableModels) {
      let result: InferenceResult;

      if (modelName === 'xgboost') {
        result = await this.predictWithXgboost(features);
      } else {
        result = await this.predictWithModel(modelName, features);
      }

      contributions[modelName] = result.probabilities;
    }

    // Weighted average
    const weightedProbs = [0, 0, 0];
    let totalWeight = 0;

    for (const [modelName, probs] of Object.entries(contributions)) {
      const weight = this.ensembleWeights[modelName as keyof typeof this.ensembleWeights] || 0.25;
      
      for (let i = 0; i < 3; i++) {
        weightedProbs[i] += probs[i] * weight;
      }
      totalWeight += weight;
    }

    // Normalize
    const finalProbs = weightedProbs.map(p => p / totalWeight);

    const predictedClass = finalProbs.indexOf(Math.max(...finalProbs));
    const confidence = Math.max(...finalProbs);

    // Find best individual model
    let bestModel = availableModels[0];
    let bestConfidence = 0;
    
    for (const [modelName, probs] of Object.entries(contributions)) {
      const maxProb = Math.max(...probs);
      if (maxProb > bestConfidence) {
        bestConfidence = maxProb;
        bestModel = modelName;
      }
    }

    return {
      probabilities: finalProbs,
      predictedClass,
      confidence,
      modelContributions: contributions,
      bestModel,
    };
  }

  /**
   * Simple prediction - use best available model
   */
  async predict(features: number[]): Promise<InferenceResult> {
    if (!this.modelsLoaded) {
      await this.loadAllModels();
    }

    // Use XGBoost if available (best model), otherwise logistic
    if (this.xgbModel) {
      return this.predictWithXgboost(features);
    }

    if (this.sessions.has('logistic')) {
      return this.predictWithModel('logistic', features);
    }

    if (this.sessions.has('random_forest')) {
      return this.predictWithModel('random_forest', features);
    }

    throw new Error('No models available');
  }

  /**
   * Extract probabilities from tensor output
   */
  private extractProbabilities(data: any): number[] {
    let probs: number[];

    if (data instanceof Float32Array) {
      probs = Array.from(data);
    } else if (Array.isArray(data)) {
      probs = data.map((v: any) => Number(v));
    } else {
      // Handle map format
      const probMap = data as any;
      if (probMap.data && Array.isArray(probMap.data)) {
        probs = Array.from(probMap.data[0].map((v: any) => Number(v)));
      } else if (Array.isArray(probMap)) {
        probs = Array.from(probMap.map((v: any) => Number(v)));
      } else {
        probs = [
          probMap[0] || probMap['0'] || 0.33,
          probMap[1] || probMap['1'] || 0.34,
          probMap[2] || probMap['2'] || 0.33,
        ];
      }
    }

    return probs;
  }

  /**
   * Get model status
   */
  getModelStatus(): {
    loaded: boolean;
    models: string[];
    paths: { [name: string]: string };
  } {
    return {
      loaded: this.modelsLoaded,
      models: this.getAvailableModels(),
      paths: Object.fromEntries(this.modelPaths),
    };
  }
}
