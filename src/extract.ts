import fs from 'fs/promises';
import path from 'path';

import * as core from '@actions/core';
import { Parser, Language } from 'web-tree-sitter';

const extractFromFile = async (filePath: string, parser: Parser) => {
  const code = await fs.readFile(filePath, 'utf8');
  const tree = parser.parse(code);

  if (!tree) {
    throw new Error(`Failed to parse file: ${filePath}`);
  }

  const rootNode = tree.rootNode;

  const moduleNode = rootNode.descendantsOfType('module_definition')[0];
  const moduleIdentity = moduleNode?.childForFieldName('module_identity');
  const address = moduleIdentity?.childForFieldName('address')?.text ?? 'unknown';
  const module = moduleIdentity?.childForFieldName('module')?.text ?? 'unknown';
  const moduleName = `${address}::${module}`;

  const functions = rootNode
    .descendantsOfType('function_definition')
    .filter(item => !!item)
    .map(fn => {
      const name = fn.childForFieldName('name')?.text ?? '(anonymous)';
      const paramList = fn.childForFieldName('parameters');

      const params =
        paramList?.namedChildren
          .filter(item => !!item)
          .map(param => {
            const name = param.childForFieldName('name')?.text ?? '';
            const typeNode = param.childForFieldName('type');
            const type = typeNode?.text ?? '';
            return { name, type };
          }) ?? [];

      const returnNode = fn.childForFieldName('return_type');
      const returnTypeNode = returnNode?.namedChildren?.[0];
      const returnType = returnTypeNode?.text ?? null;

      return { name, params, return: returnType };
    });

  return { moduleName, functions };
};

const main = async () => {
  if (!process.env.MOVE_DIR) {
    core.warning(
      'Skipping extraction from MOVE_DIR as it is not set in the environment variables.',
    );
  } else {
    const MOVE_DIR = path.join(process.env.MOVE_DIR ?? '.', 'sources');
    const WASM_DIR = path.resolve(__dirname, 'tree-sitter-move.wasm');

    await Parser.init();
    const parser = new Parser();
    const MoveLang = await Language.load(WASM_DIR);
    parser.setLanguage(MoveLang);

    const result: {
      [moduleName: string]: {
        name: string;
        params: { name: string; type: string }[];
        return: string | null;
      }[];
    } = {};

    const files = (await fs.readdir(MOVE_DIR)).filter(f => f.endsWith('.move'));

    if (files.length === 0) {
      core.warning(`No .move files found in the directory: ${MOVE_DIR}`);
      return;
    } else {
      core.info(`Found [${files.join(', ')}] files in the directory: ${MOVE_DIR}`);
    }

    for (const file of files) {
      const { moduleName, functions } = await extractFromFile(path.join(MOVE_DIR, file), parser);
      if (functions.length > 0) {
        result[moduleName] = functions;
      }
    }

    if (Object.keys(result).length === 0) {
      core.warning('No functions found in the provided MOVE files.');
    } else {
      const outputPath = path.resolve('./params.json');
      await fs.writeFile(outputPath, JSON.stringify(result), 'utf-8');
      core.info(JSON.stringify(result, null, 2));
    }
  }
};

main().catch(err => {
  core.setFailed(`❌ ${err}`);
  process.exit(1);
});
