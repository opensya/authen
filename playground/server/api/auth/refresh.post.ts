import { refreshTokenSchema } from '~~/shared/schemas/authentication';

export default defineEventHandler(async (event) => {
  await authService.init();

  const dto = await readValidatedBody(event, refreshTokenSchema.parse);

  return authService.refresh(dto);
});
