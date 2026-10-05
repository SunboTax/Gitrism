/* Independent lane layout based on commit parent hashes in topological order. */
(function (root) {
  function layoutGraph(commits) {
    let active = [], width = 1, nextColor = 0;
    const colors = new Map();
    const rows = commits.map(commit => {
      const before = active.slice();
      let lane = active.indexOf(commit.hash);
      if (lane < 0) { lane = active.length; active.push(commit.hash); }
      if (!colors.has(commit.hash)) colors.set(commit.hash, nextColor++);
      const color = colors.get(commit.hash);
      const next = active.slice();
      next.splice(lane, 1);
      commit.parents.forEach((parent, index) => {
        if (!colors.has(parent)) colors.set(parent, index === 0 ? color : nextColor++);
        if (!next.includes(parent)) next.splice(Math.min(lane + index, next.length), 0, parent);
      });
      const edges = [];
      before.forEach((hash, start) => {
        if (hash === commit.hash) edges.push({ from: start, to: lane, half: "top", color: colors.get(hash) });
        else {
          const end = next.indexOf(hash);
          if (end >= 0) edges.push({ from: start, to: end, half: "full", color: colors.get(hash) });
        }
      });
      commit.parents.forEach(parent => edges.push({ from: lane, to: next.indexOf(parent), half: "bottom", color: colors.get(parent), parent }));
      width = Math.max(width, before.length, next.length, lane + 1);
      active = next;
      return { hash: commit.hash, lane, color, edges, merge: commit.parents.length > 1 };
    });
    return { rows, width, boundary: active };
  }
  if (typeof module === "object" && module.exports) module.exports = { layoutGraph };
  else root.layoutGraph = layoutGraph;
})(globalThis);
