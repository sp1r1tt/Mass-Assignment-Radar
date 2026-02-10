import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Настройка Swagger
  const config = new DocumentBuilder()
    .setTitle('AI Image Generator — Mass Assignment Lab')
    .setDescription('Учебная лаборатория по уязвимостям Mass Assignment (2026)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customCss: `
      .swagger-ui .btn.execute { margin-right: 10px; }
      .swagger-ui .btn.btn-clear { margin-left: 10px; }
      .swagger-ui .auth-btn-wrapper .btn.authorize { margin-right: 10px; }
      .swagger-ui .auth-btn-wrapper .btn-done { margin-left: 10px; }
    `,
  });

  // В реальной жизни ValidationPipe часто не настраивают строго, 
  // что и приводит к Mass Assignment. Для лабы мы его упростим или уберем.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false, // Разрешаем любые поля для демонстрации уязвимости
      transform: true,
    }),
  );

  await app.listen(process.env.PORT || 3000);
  console.log(`Lab running → http://localhost:${process.env.PORT || 3000}`);
}
bootstrap();