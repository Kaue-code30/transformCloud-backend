"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
    app.enableCors({ origin: 'http://localhost:3000', credentials: true });
    const port = process.env.PORT ?? 3001;
    await app.listen(port);
    console.log(`Backend rodando em http://localhost:${port}/api`);
}
bootstrap();
//# sourceMappingURL=main.js.map