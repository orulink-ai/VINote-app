// Execute the CURRENT production pcmFrame function, stripped of TypeScript only.
// No imported App modules, credentials, sockets or provider calls.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const source = fs.readFileSync(path.join(__dirname, '../src/lib/asrStream.ts'), 'utf8')
const ast = babel.parseSync(source, { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] } })
const fn = ast.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'pcmFrame')?.declaration
if (!fn) throw new Error('Production pcmFrame not found')
const code = babel.transformSync(source.slice(fn.start, fn.end), {
  babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-typescript'],
}).code
const pcmFrame = vm.runInNewContext(code + '; pcmFrame')
const entries = [[0, 0, 6400, true, false], [1, 1, 6400, false, false], [6882, 6882, 4754, false, true], [-1, 0, 6400, true, false], [-2, 1, 2, false, true]]
fs.writeFileSync(process.argv[2], entries.map(([name, sequence, bytes, first, last]) =>
  `${name}\t${Buffer.from(new Uint8Array(pcmFrame(Buffer.alloc(bytes).toString('base64'), sequence, first, last))).toString('base64')}`
).join('\n'))
