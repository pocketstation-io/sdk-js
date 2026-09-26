import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import './clean-typescript-output.mjs';

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
let sourceProgram;
for (const format of ['esm', 'commonjs']) {
  const options = format === 'commonjs' ? {
    ...parsed.options,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    outDir: 'dist/cjs',
  } : parsed.options;
  const program = ts.createProgram(parsed.fileNames, options);
  if (format === 'esm') sourceProgram = program;
  const result = program.emit();
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...result.diagnostics];
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: process.cwd,
      getNewLine: () => '\n',
    }));
    process.exit(1);
  }
  for (const file of ['require-package.cjs', 'require-package.d.cts']) {
    cpSync(`src/${file}`, `${options.outDir}/${file}`);
  }
}
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
mkdirSync('dist/wrappers');
const checker = sourceProgram.getTypeChecker();
for (const entry of ['root', 'node', 'browser', 'control', 'demo', 'voice']) {
  const target = entry === 'root' ? 'index.js' : `${entry}/index.js`;
  const source = sourceProgram.getSourceFile(`src/${target.replace(/\.js$/, '.ts')}`);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source))
    .filter((symbol) => {
      if (symbol.declarations?.some((declaration) => ts.isExportSpecifier(declaration)
        && (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly))) return false;
      const value = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return (value.flags & ts.SymbolFlags.Value) !== 0;
    }).map((symbol) => symbol.name);
  for (const name of exports) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw new Error(`Invalid named export: ${name}`);
  }
  writeFileSync(`dist/wrappers/${entry}.mjs`,
    `import api from '../cjs/${target}';\n`
    + exports.map((name) => `export const ${name} = api.${name};\n`).join(''));
}
