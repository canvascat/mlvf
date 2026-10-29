export type AppleMusicAuth = {
  mediaUserToken: string;
  storefront?: string;
};

export function readAppleMusicAuth(
  env: NodeJS.ProcessEnv = process.env,
): AppleMusicAuth | null {
  const mediaUserToken = env.MEDIA_USER_TOKEN?.trim();
  if (!mediaUserToken) {
    return null;
  }
  const storefront = env.APPLE_MUSIC_STOREFRONT?.trim().toLowerCase();
  return {
    mediaUserToken,
    ...(storefront ? { storefront } : {}),
  };
}
