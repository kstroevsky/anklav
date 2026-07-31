import { writeFile } from 'node:fs/promises';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createApplication } from './main';

async function writeOpenApi() {
  const app = await createApplication();
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Anklav API').setVersion('v1').build());
  await writeFile('openapi.json', JSON.stringify(document, null, 2));
  await app.close();
}

void writeOpenApi();
