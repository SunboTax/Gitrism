// Keep GitService usable outside VS Code; activation supplies the UI language.
interface LocalizationApi {
  resolveLocale(language?: string): string;
  createTranslator(messages?: Record<string, string>): (message: string, ...args: unknown[]) => string;
}
const api = require("../resources/i18n.js") as LocalizationApi;
const catalogs: Record<string, Record<string, string>> = {
  "zh-CN": require("../resources/locales/zh-cn.json"),
  "zh-TW": require("../resources/locales/zh-tw.json")
};
let locale = "en";
let translate = api.createTranslator();
export function setLanguage(language?: string): void {
  locale = api.resolveLocale(language);
  translate = api.createTranslator(catalogs[locale]);
}
export function getLocalization(): { locale: string; messages: Record<string, string> } {
  return { locale, messages: catalogs[locale] || {} };
}
export function getLocale(): string { return locale; }
export function t(message: string, ...args: unknown[]): string { return translate(message, ...args); }
