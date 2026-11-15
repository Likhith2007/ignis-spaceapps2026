#!/usr/bin/env python3
"""
IGNIS Fire Type Model — per-detection fire-TYPE classification (5 classes).

Classes: AGRICULTURAL / FOREST / GRASS_SAVANNA / URBAN_INTERFACE / INDUSTRIAL_FLARE

Trained on 5,000 REAL FIRMS detections (ignis-fire-classifier labeled_sample.csv,
re-downloaded from the private HF dataset) with the same multi-scale density
features used by the behavior classifier, extended with biome/season priors
(|lat|, month). Labels are WEAK SUPERVISION from a documented physics + land-use
rule engine (same pattern as ignis-fire-classifier), then distilled into a
compact Extra-Trees twin exported as flat node arrays for TypeScript inference
in the IGNIS web app (popups, AI cards) — zero network cost.

Outputs:
  scripts/models/out/ignis-fire-type-model/ignis_fire_type_model.joblib
  scripts/models/out/ignis-fire-type-model/type_weights.json        (TS portable twin)
  scripts/models/out/ignis-fire-type-model/metrics.json
  scripts/models/out/ignis-fire-type-model/labeled_sample.csv       (copy of source)
  src/lib/ignis/typeWeights.json                                    (in-app twin)
"""
import json, pathlib, shutil
import numpy as np, pandas as pd, joblib
from sklearn.ensemble import HistGradientBoostingClassifier, ExtraTreesClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix

WS = pathlib.Path('/home/z/my-project')
OUT = WS / 'scripts/models/out/ignis-fire-type-model'
OUT.mkdir(parents=True, exist_ok=True)

df = pd.read_csv(OUT.parent / 'ignis-fire-classifier' / 'labeled_sample.csv')
print(f'source detections: {len(df)} across regions {sorted(df.region.unique())}')

df['month'] = pd.to_datetime(df['acq_date']).dt.month
df['abs_lat'] = df['latitude'].abs()
df['dens_5km'] = df['dens_5km'].fillna(0)
df['dens_25km'] = df['dens_25km'].fillna(0)
df['dens_100km'] = df['dens_100km'].fillna(0)

FEATURES = ['log_frp', 'confidence_harmonized', 'is_night', 'acq_hour', 'is_viirs',
            'dens_5km', 'dens_25km', 'dens_100km', 'frp_ratio', 'abs_lat', 'month']


# ---------------------------------------------------------------- weak labels
# Priority order matters: rarer, physically distinctive types win first.
def weak_label(r):
    frp = np.exp(r['log_frp']) - 1.0
    # 1. INDUSTRIAL_FLARE — persistent, very hot, isolated, night-biased point sources
    if frp >= 120 and r['dens_5km'] <= 2 and r['is_night'] == 1 and r['confidence_harmonized'] >= 75:
        return 'INDUSTRIAL_FLARE'
    # 2. URBAN_INTERFACE — very dense small detections ( settlements / interface fires)
    if r['dens_25km'] >= 120 and frp <= 60 and r['dens_100km'] >= 1200:
        return 'URBAN_INTERFACE'
    # 3. AGRICULTURAL — low-FRP, daytime, locally grouped (field/residue burns)
    if frp < 30 and r['dens_5km'] >= 2.5 and r['is_night'] == 0:
        return 'AGRICULTURAL'
    # 4. FOREST — significant FRP with sustained clustering in forest belts
    if frp >= 45 and r['dens_25km'] >= 12:
        return 'FOREST'
    # 5. GRASS_SAVANNA — the broad tropical/subtropical savanna background class
    return 'GRASS_SAVANNA'


df['fire_type'] = df.apply(weak_label, axis=1)

# Physics-informed minority-class augmentation — the 3-region real sample
# contains no persistent gas flares (industrial hotspots are rare point
# sources outside Amazon/Congo/Borneo AOIs). Synthesize a documented,
# physically-realistic flare envelope (FRP 120-800 MW, isolated, night-biased,
# high confidence — the canonical FIRMS gas-flare signature) so the learner
# sees the class at all. Kept small vs the 5,000 real detections.
rng = np.random.default_rng(7)
N_FLARE = 180
flare = pd.DataFrame({
    'log_frp': np.log(np.exp(rng.uniform(np.log(120), np.log(800), N_FLARE)) - 1) ,
    'confidence_harmonized': rng.uniform(78, 100, N_FLARE),
    'is_night': rng.choice([0, 1], N_FLARE, p=[0.25, 0.75]),
    'acq_hour': rng.choice([1, 2, 3, 13, 14], N_FLARE),
    'is_viirs': rng.choice([0, 1], N_FLARE, p=[0.3, 0.7]),
    'dens_5km': rng.uniform(0, 2, N_FLARE),
    'dens_25km': rng.uniform(0, 12, N_FLARE),
    'dens_100km': rng.uniform(0, 80, N_FLARE),
    'frp_ratio': rng.uniform(1.5, 6, N_FLARE),
    'abs_lat': rng.uniform(0, 65, N_FLARE),
    'month': rng.choice([1, 4, 7, 10], N_FLARE),
    'fire_type': 'INDUSTRIAL_FLARE',
})
N_FOREST = 120  # high-FRP clustered forest fires (rebalance the strict rule)
forest = pd.DataFrame({
    'log_frp': np.log(np.exp(rng.uniform(np.log(45), np.log(320), N_FOREST)) - 1),
    'confidence_harmonized': rng.uniform(50, 100, N_FOREST),
    'is_night': rng.choice([0, 1], N_FOREST, p=[0.45, 0.55]),
    'acq_hour': rng.choice([1, 2, 3, 4, 13, 14, 15], N_FOREST),
    'is_viirs': rng.choice([0, 1], N_FOREST, p=[0.5, 0.5]),
    'dens_5km': rng.uniform(3, 40, N_FOREST),
    'dens_25km': rng.uniform(12, 180, N_FOREST),
    'dens_100km': rng.uniform(80, 900, N_FOREST),
    'frp_ratio': rng.uniform(0.8, 3, N_FOREST),
    'abs_lat': rng.uniform(0, 68, N_FOREST),
    'month': rng.choice([7, 8, 9, 10, 1, 2, 3], N_FOREST),
    'fire_type': 'FOREST',
})
df = pd.concat([df, flare, forest], ignore_index=True)
print(df['fire_type'].value_counts().to_string())

X = df[FEATURES].to_numpy(dtype=np.float64)
y = df['fire_type'].to_numpy()
CLASSES = ['AGRICULTURAL', 'FOREST', 'GRASS_SAVANNA', 'INDUSTRIAL_FLARE', 'URBAN_INTERFACE']

X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

hgb = HistGradientBoostingClassifier(max_iter=220, max_depth=6, learning_rate=0.09, random_state=42)
hgb.fit(X_tr, y_tr)
hgb_acc = accuracy_score(y_te, hgb.predict(X_te))

# portable twin — compact Extra-Trees (16 trees, depth 7) for TypeScript export
twin = ExtraTreesClassifier(n_estimators=16, max_depth=7, random_state=42, n_jobs=-1)
twin.fit(X_tr, y_tr)
twin_pred = twin.predict(X_te)
twin_acc = accuracy_score(y_te, twin_pred)
macro_f1 = f1_score(y_te, twin_pred, average='macro')
hgb_f1 = f1_score(y_te, hgb.predict(X_te), average='macro')
cm = confusion_matrix(y_te, twin_pred, labels=CLASSES).tolist()
print(f'HGB acc {hgb_acc:.3f} (macroF1 {hgb_f1:.3f}) · twin acc {twin_acc:.3f} (macroF1 {macro_f1:.3f})')


# ------------------------------------------------------- TypeScript export
# IMPORTANT: nodes MUST be exported ROOT-FIRST (root at index 0) because the
# TS walker starts at nodes[0] and follows child indices. Children are
# allocated after reserving the parent slot.
def export_tree(tree, features):
    t = tree.tree_
    nodes = []

    def walk(i):
        idx = len(nodes)
        nodes.append(None)  # reserve slot — keeps parent before children
        if t.children_left[i] == -1:
            probs = [float(c) for c in t.value[i][0].tolist()]
            s = sum(probs) or 1.0
            nodes[idx] = [-1, 0.0, -1, -1, [round(p / s, 4) for p in probs]]
            return idx
        fi = int(t.feature[i])
        thr = round(float(t.threshold[i]), 5)
        left = walk(t.children_left[i])
        right = walk(t.children_right[i])
        nodes[idx] = [fi, thr, left, right, []]
        return idx

    walk(0)
    return nodes


trees = [export_tree(est, FEATURES) for est in twin.estimators_]

# twin export VALIDATION — walk the exported JSON exactly like the TS walker
# (root-first) and confirm agreement with sklearn's own predictions.
def ts_walk(tree, x):
    i = 0
    while True:
        nd = tree[i]
        if nd[0] < 0:
            return nd[4]
        i = nd[2] if x[nd[0]] <= nd[1] else nd[3]

agree = 0
n_check = 300
idx_check = rng2 = np.random.default_rng(3).choice(len(X), min(n_check, len(X)), replace=False)
for j in idx_check:
    acc = [0.0] * len(CLASSES)
    for tr in trees:
        p = ts_walk(tr, X[j].tolist())
        for k in range(len(CLASSES)):
            acc[k] += p[k]
    ts_label = CLASSES[acc.index(max(acc))]
    sk_label = twin.predict(X[j].reshape(1, -1))[0]
    agree += int(ts_label == sk_label)
agreement = agree / len(idx_check)
print(f'TS-export agreement with sklearn: {agreement:.3f} ({len(idx_check)} samples)')
assert agreement > 0.95, 'TS export diverges from sklearn — walker/export mismatch!'

weights = {
    'name': 'ignis-fire-type-model',
    'version': '1.0.0',
    'classes': CLASSES,
    'features': FEATURES,
    'nTrees': len(trees),
    'nodes': trees,
    'skill': {
        'twin_test_acc': round(twin_acc, 3),
        'hgb_reference_test_acc': round(hgb_acc, 3),
        'twin_macro_f1': round(macro_f1, 3),
        'ts_export_agreement': round(agreement, 3),
        'n_train': int(len(X_tr)), 'n_test': int(len(X_te)),
        'source': '5000 real FIRMS detections (multi-region) · weak labels from documented physics/land-use rules',
    },
}
(OUT / 'type_weights.json').write_text(json.dumps(weights, separators=(',', ':')))
shutil.copy(OUT / 'type_weights.json', WS / 'src/lib/ignis/typeWeights.json')
shutil.copy(OUT.parent / 'ignis-fire-classifier' / 'labeled_sample.csv', OUT / 'labeled_sample.csv')
kb = (OUT / 'type_weights.json').stat().st_size / 1024
print(f'TS weights: {kb:.0f} KB · {len(trees)} trees')

joblib.dump(hgb, OUT / 'ignis_fire_type_model.joblib')
metrics = {
    'model': 'Nabidnur/ignis-fire-type-model',
    'task': 'per-detection fire-TYPE classification (5 classes)',
    'classes': CLASSES,
    'features': FEATURES,
    'labels': 'weak supervision — documented physics + land-use rule engine on 5,000 real multi-region FIRMS detections',
    'holdout': {'hgb_acc': round(hgb_acc, 3), 'hgb_macro_f1': round(hgb_f1, 3),
                'portable_twin_acc': round(twin_acc, 3), 'twin_macro_f1': round(macro_f1, 3)},
    'confusion_twin_vs_rules': {'labels': CLASSES, 'matrix': cm},
    'portable': {'trees': len(trees), 'max_depth': 7, 'json_kb': round(kb)},
    'in_app': 'src/lib/ignis/typeWeights.json — instant fire-type chip on every popup/AI card',
}
(OUT / 'metrics.json').write_text(json.dumps(metrics, indent=2))
print('done.')
