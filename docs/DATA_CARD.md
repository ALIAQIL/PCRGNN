# Data card and integrity policy

## PCL integrity demonstration

The eight files under `data/pc_rgnn/` are public PCD files from the Point Cloud Library test corpus. Their provenance is recorded in `data/pc_rgnn/provenance.json`, including a pinned upstream Git revision, source URL, byte count, and SHA-256 digest. Run `python verify_integrity.py --online` to verify both local bytes and the pinned remote copies.

The notebook keeps three origins separate:

- **Raw source:** the eight PCL files, one source identifier per file.
- **Derived data:** normalized or subsampled views of a raw source cloud.
- **Synthetic data:** midpoint-interpolated completion points and any optional perturbations.

The filename-to-class mapping is a manual project label, not an official PCL benchmark annotation. The source count is too small and class coverage is too imbalanced for a trustworthy class-balanced holdout. Therefore the PCL notebook does not report classification accuracy or claim generalization. It demonstrates parsing, graph construction, completion, and attention encoding only.

## nuScenes mini detection track

The nuScenes mini files are not included in Git. The user must download them from the official nuScenes distribution and set `NUSCENES_ROOT` locally. The notebook uses the official devkit to read LiDAR, scenes, categories, poses, and annotated boxes. Its development split is scene-disjoint and its object-level detector reports diagnostic center, size, yaw, and axis-aligned 3D IoU metrics. These results are development diagnostics on the mini split, not full nuScenes leaderboard results.

## Reproducibility boundary

No augmented copy is an independent real scan. No absent nuScenes result is fabricated: the detection notebook exits its data-dependent sections with setup instructions when the external dataset is not mounted.
