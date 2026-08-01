import { BadRequestException } from '@nestjs/common';

/** Avoid exposing a disabled feature as a permission failure. */
export class NotFoundExceptionLike extends BadRequestException {
  constructor() {
    super('GitHub integration is disabled.');
  }
}
