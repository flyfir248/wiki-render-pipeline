#!/usr/bin/env bash
# Rebuilds the map's country borders (renderer/src/data/countries-ind-*.json) from Natural Earth's
# India point of view: the borders as the Government of India shows them. Public domain.
# Names are kept as world-atlas spelled them, so scripts and aliases in map.tsx still match.
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/renderer/src/data"
tmp="$(mktemp -d)"
base=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_cultural/ne_10m_admin_0_countries_ind
for x in shp shx dbf prj; do curl -fsSL -o "$tmp/ind.$x" "$base.$x"; done
rename='var R={"Dem. Rep. Korea":"North Korea","Republic of Korea":"South Korea","Democratic Republic of the Congo":"Dem. Rep. Congo","Republic of the Congo":"Congo","United States":"United States of America","North Macedonia":"Macedonia","Faeroe Islands":"Faeroe Is.","Saint Kitts and Nevis":"St. Kitts and Nevis","Sao Tome and Principe":"São Tomé and Principe","Saint-Martin":"St-Martin","Wallis and Futuna Islands":"Wallis and Futuna Is.","Fr. S. and Antarctic Lands":"Fr. S. Antarctic Lands"}; if (R[name]) name=R[name]'
for spec in "50m 6%" "110m 1.2%"; do
  set -- $spec
  npx -y mapshaper@0.6 "$tmp/ind.shp" encoding=utf8 -filter-fields NAME -rename-fields name=NAME -each "$rename" \
    -simplify "$2" keep-shapes -clean -rename-layers countries -dissolve + name=land \
    -o "$out/countries-ind-$1.json" format=topojson quantization=100000 target='*'
done
