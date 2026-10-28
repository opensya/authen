import { beginAuthenticationSchema } from '~~/shared/schemas/authentication';

export default defineEventHandler(async (event) => {
  await authService.init();

  const authorization = getHeader(event, 'authorization');
  const userAgent = getHeader(event, 'user-agent');
  const ipAddress = getRequestIP(event, { xForwardedFor: true });
  const dto = await readValidatedBody(event, beginAuthenticationSchema.parse);

  return authService.begin(dto, { authorization, userAgent, ipAddress });
});
