const manifestUrl = new URL('./asset-manifest.json', import.meta.url);

let assetManifestPromise;

export function loadAssetManifest() {
  assetManifestPromise ??= fetch(manifestUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${manifestUrl.pathname}: ${response.status}`);
    }
    return response.json();
  });

  return assetManifestPromise;
}
