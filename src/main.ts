import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create NestJS app with logging levels
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // Get config service for environment variables
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;
  const apiVersion = configService.get<string>('apiVersion') || 'api/v1';

  // Set global API prefix
  app.setGlobalPrefix(apiVersion);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Enable CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Swagger API Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Football AI Prediction API')
    .setDescription('AI-powered football match prediction system with ML models')
    .setVersion('1.0')
    .addTag('fixtures', 'Match fixtures and schedules')
    .addTag('teams', 'Team information and statistics')
    .addTag('predictions', 'AI match predictions with confidence scores')
    .addTag('standings', 'League standings')
    .addTag('sync', 'Data synchronization endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // Start the server
  await app.listen(port);

  // Log startup messages
  const serverUrl = `http://localhost:${port}`;
  logger.log(`Football AI API is running on: ${serverUrl}`);
  logger.log(`API endpoints: ${serverUrl}/${apiVersion}`);
  logger.log(`Swagger docs: ${serverUrl}/docs`);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
