import { Transaction, TransactionResult } from '@mysten/sui/transactions';

import { MvrConfig, Network } from '../types';

const splitBase64ByByteLength = (base64: string, maxBytes: number): string[] => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(base64);
  const chunks: string[] = [];

  for (let i = 0; i < bytes.length; i += maxBytes) {
    const slice = bytes.slice(i, i + maxBytes);
    chunks.push(new TextDecoder().decode(slice));
  }

  return chunks;
};

export const setCoreMetadata = (
  target: string,
  registry: {
    $kind: 'Input';
    Input: number;
    type?: 'object';
  },
  appCap:
    | TransactionResult
    | {
        $kind: 'Input';
        Input: number;
        type?: 'object';
      },
  config: MvrConfig,
): ((tx: Transaction) => void) => {
  const keys: [string, string][] = [
    ['description', config.app_desc],
    ['homepage_url', config.homepage_url ?? (process.env.GIT_REPO || '')],
    [
      'documentation_url',
      config.documentation_url ?? (process.env.GIT_REPO ? `${process.env.GIT_REPO}#readme` : ''),
    ],
    ['icon_url', config.icon_url || ''],
  ];

  return (transaction: Transaction) => {
    for (const [key, value] of keys) {
      transaction.moveCall({
        target: `${target}::move_registry::set_metadata`,
        arguments: [registry, appCap, transaction.pure.string(key), transaction.pure.string(value)],
      });
    }
  };
};

export const setPkgMetadata = (
  target: string,
  packageInfo:
    | TransactionResult
    | {
        $kind: 'Input';
        Input: number;
        type?: 'object';
      },
  tx_digest: string,
  provenance: string,
  params: string | null = null,
): ((tx: Transaction) => void) => {
  const prov_chunks = splitBase64ByByteLength(provenance, 16380);
  const params_chunks = params ? splitBase64ByByteLength(params, 16380) : [];
  const keys: [string, string][] = [
    ['prov_tx_', tx_digest],
    ...prov_chunks.map((chunk, i): [string, string] => [`prov_jsonl_${i}`, chunk]),
    ...params_chunks.map((chunk, i): [string, string] => [`prov_params_${i}`, chunk]),
  ];

  return (transaction: Transaction) => {
    for (const [key, value] of keys) {
      transaction.moveCall({
        target: `${target}::package_info::set_metadata`,
        arguments: [packageInfo, transaction.pure.string(key), transaction.pure.string(value)],
      });
    }
  };
};

export const unsetAllMetadata = async (
  network: Network,
  name: string,
  target: {
    pkg: string;
    core: string;
  },
  registry: {
    $kind: 'Input';
    Input: number;
    type?: 'object';
  },
  packageInfo: {
    $kind: 'Input';
    Input: number;
    type?: 'object';
  },
  appCap:
    | TransactionResult
    | {
        $kind: 'Input';
        Input: number;
        type?: 'object';
      },
): Promise<(tx: Transaction) => void> => {
  const url = `https://${network}.mvr.mystenlabs.com/v1/names/${name}`;
  const maxRetries = 5;
  const delayMs = 2000;

  let json;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      json = await response.json();
      break;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`❌ Failed after ${maxRetries} attempts: `, err);
        throw err;
      }
      console.warn(`⚠️ Fetch failed (attempt ${attempt}/${maxRetries}): `, err);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }

  const coreKeys = Object.keys(json?.metadata || {});
  const pkgKeys = Object.keys(json?.package_info || {});

  return (transaction: Transaction) => {
    for (const key of coreKeys) {
      transaction.moveCall({
        target: `${target.core}::move_registry::unset_metadata`,
        arguments: [registry, appCap, transaction.pure.string(key)],
      });
    }
    for (const key of pkgKeys) {
      transaction.moveCall({
        target: `${target.pkg}::package_info::unset_metadata`,
        arguments: [packageInfo, transaction.pure.string(key)],
      });
    }
  };
};
