export type ObituaryPost = { headline: string; lede: string; url: string };

export const postBody = (p: ObituaryPost): string => `${p.headline}\n\n${p.lede}\n\n${p.url}`;
