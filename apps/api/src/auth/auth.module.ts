import { Global, Module } from '@nestjs/common';
import { AuthController } from './controller';
import { SessionGuard } from './guard';
import { AuthService } from './service';
import { DatabaseModule } from '../core/database.module';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
