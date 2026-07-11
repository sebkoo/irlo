import { serverEnvSchema, type ServerEnv } from '@irlo/contracts';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(env);
}
