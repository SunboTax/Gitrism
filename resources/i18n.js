/* Shared, dependency-free localization for the Extension Host and Webview. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitrismI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function resolveLocale(language) {
    const value = String(language || 'en').replace(/_/g, '-').toLowerCase();
    if (/^zh(?:-|$)/.test(value)) {
      return /^zh-(?:hant(?:-|$)|tw(?:-|$)|hk(?:-|$)|mo(?:-|$))/.test(value) ? 'zh-TW' : 'zh-CN';
    }
    return 'en';
  }
  function createTranslator(messages = {}) {
    return function (message, ...args) {
      const translated = Object.prototype.hasOwnProperty.call(messages, message) ? messages[message] : message;
      // A replacement callback keeps dollar signs and nested braces in values literal.
      return String(translated).replace(/\{(\d+)\}/g, (token, index) => Number(index) < args.length ? String(args[index]) : token);
    };
  }
  return { resolveLocale, createTranslator };
});
