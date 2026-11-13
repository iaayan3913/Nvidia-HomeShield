// Vite `?url` imports resolve to a string URL. Declared locally because the app has no shared vite-env typings.
declare module '*?url' {
  const url: string;
  export default url;
}
