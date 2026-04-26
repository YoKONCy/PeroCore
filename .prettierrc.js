/**
 * @file Prettier 配置 (唯一配置源)
 * @description 遵循 01_NAMING_CONVENTIONS.md 规范
 *              搭配 ESLint plugin:prettier/recommended 使用，
 *              ESLint 通过 eslint-config-prettier 自动关闭所有冲突规则。
 */
module.exports = {
  semi: false,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  printWidth: 100,
  bracketSpacing: true,
  arrowParens: 'always',
  // Windows/Linux 跨平台兼容
  endOfLine: 'auto',
  // Vue 模板: 不让 Prettier 因空白敏感度拆坏内联属性
  htmlWhitespaceSensitivity: 'ignore',
  vueIndentScriptAndStyle: false,
}
