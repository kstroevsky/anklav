import { Module } from '@nestjs/common';
import { AccountController } from '../domain/account.controller';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../core/database.module';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AccountController],
})
export class AccountModule {}

