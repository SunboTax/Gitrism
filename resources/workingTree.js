/* Original path grouping, shared by the local webview and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitrismWorkingTree = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function build(files) {
    const root = { name: '', path: '', directories: new Map(), files: [], count: 0 };
    for (const file of files) {
      const parts = file.path.split('/'); let node = root;
      node.count++;
      for (let i=0; i<parts.length-1; i++) {
        const name = parts[i], path = parts.slice(0,i+1).join('/');
        if (!node.directories.has(name)) node.directories.set(name, { name, path, directories: new Map(), files: [], count: 0 });
        node = node.directories.get(name); node.count++;
      }
      node.files.push(file);
    }
    const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
    function sort(node) {
      node.directories = new Map([...node.directories].sort(([a],[b])=>compare(a,b)));
      node.files.sort((a,b)=>compare(a.path,b.path));
      for (const child of node.directories.values()) sort(child);
    }
    sort(root);
    return root;
  }
  return { build };
});
