import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      title: 'Invalid request body',
      errors: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const detail = typeof response === 'string' ? response : (response as { message?: unknown })?.message;
    reply.status(status).type('application/problem+json').send({
      type: `https://anklav.local/problems/${status}`,
      title: typeof response === 'object' && response && 'title' in response ? (response as { title: string }).title : HttpStatus[status],
      status,
      detail: Array.isArray(detail) ? detail.join('; ') : detail ?? 'An unexpected error occurred.',
      instance: request.url,
      ...(typeof response === 'object' && response ? response : {}),
    });
  }
}
