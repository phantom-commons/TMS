export type AssetEntry = {
  hash: string;
  path: string;
  mimeType: string;
};

/**
 * Mapa hash (SHA-256 hex) → archivo servido. El hash es la identidad del asset
 * dentro del log (`PLACE.assetHash`); el path apunta a un archivo público.
 */
export const ASSET_INDEX: Record<string, AssetEntry> = {
  'aa6dc27b1965ea897bf90bfaa1c45b33ecf190b66a243ac5c05e6f57ec7c3429': {
    hash: 'AA6DC27B1965EA897BF90BFAA1C45B33ECF190B66A243AC5C05E6F57EC7C3429',
    path: 'assets/foliage2_medium.glb',
    mimeType: 'model/gltf-binary',
  },
  '7755fc8d7972e5e101321315b07c3cfb9eed7ef21676375eecd1ee73c86cdb70': {
    hash: '7755FC8D7972E5E101321315B07C3CFB9EED7EF21676375EECD1EE73C86CDB70',
    path: 'assets/foliage2_small.glb',
    mimeType: 'model/gltf-binary',
  },
  '56a54c08bc3e793e9fedc540e8dabaf0605b5489e74c5116754a92291e738af0': {
    hash: '56A54C08BC3E793E9FEDC540E8DABAF0605B5489E74C5116754A92291E738AF0',
    path: 'assets/foliage3.glb',
    mimeType: 'model/gltf-binary',
  },
  '9f00c115b80fd79be5f3e63a7d09c49d708ab694b1fd798e20630cc00c2e244f': {
    hash: '9F00C115B80FD79BE5F3E63A7D09C49D708AB694B1FD798E20630CC00C2E244F',
    path: 'assets/pino1.glb',
    mimeType: 'model/gltf-binary',
  },
};

export const assetPathFor = (hash: string): string | null => ASSET_INDEX[hash.toLowerCase()]?.path ?? null;
