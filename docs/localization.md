# Localization

Gitrism uses `vscode.env.language`, which represents the VS Code client's display language, including in a Remote SSH workspace. Set it using **Configure Display Language** in the Command Palette and restart VS Code when prompted. There is no separate extension language preference.

| VS Code language | Gitrism interface |
| --- | --- |
| English and English variants | English |
| Simplified Chinese, `zh`, `zh-CN`, `zh-SG`, or `zh-Hans` | Simplified Chinese |
| Traditional Chinese, `zh-TW`, `zh-HK`, `zh-MO`, or `zh-Hant` | Traditional Chinese |
| Other languages | English |

Commands and configuration descriptions use VS Code's native `package.nls.json`, `package.nls.zh-cn.json`, and `package.nls.zh-tw.json` bundles. The workspace, sidebar, prompts, and extension-generated errors use the shared localization helper and catalogs in `resources/locales/`.

English messages are the source keys. Missing translations fall back to the English source text. Numbered placeholders such as `{0}` and `{1}` support different word orders; values are inserted literally, then escaped when rendered in the Webview. Commit messages, authors, reference names, file paths, and raw Git diagnostics are not translated. The brand name and slogan remain unchanged.

Dates use the selected interface locale and the environment's time zone. Git's output language follows Git's own environment; Gitrism does not change Git locale variables.

## Updating translations

Use `t("English message", value)` in the Extension Host and `t` or the HTML-escaping `tr` helper in the Webview. Keep complete parameterized messages together so translators can reorder the arguments. Add the corresponding entries to both Chinese catalogs. Avoid translating user-provided repository content.

To add another language, add its runtime catalog, register it in `src/localization.ts` and `resources/i18n.js`, and supply a matching `package.nls.<language>.json` bundle for native VS Code contributions. Add that locale to the browser test loop and update the documented support table.

Run `npm run check` and `npm test`. Tests verify source-message coverage, manifest keys, placeholder consistency, literal argument handling, fallback behavior, localized Git validation and confirmations, and all nine views in each supported language. Browser checks include narrow windows, short panels, content security policy, escaping, draft persistence, and preservation of repository text.
