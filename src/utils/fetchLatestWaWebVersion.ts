import { WAVersion } from 'baileys';

const cachedVersion: WAVersion = [2, 3000, 1043857760];

export const fetchLatestWaWebVersion = async (options?: any) => {
  void options;
  const envVersion = process.env.CONFIG_SESSION_PHONE_VERSION;
  if (envVersion) {
    const parts = envVersion.split('.').map(Number);
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      return {
        version: parts as WAVersion,
        isLatest: true,
      };
    }
  }

  return {
    version: cachedVersion,
    isLatest: true,
  };
};
