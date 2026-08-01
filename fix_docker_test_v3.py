from pathlib import Path

# The problem was that the bin folder of stage_dir was copied to /data/data/com.termux/files/usr/bin
# But we need to make sure the binary is correctly invoked for npm integration testing.

npm_py = Path("scripts/core/npm.py").read_text()
npm_py = npm_py.replace(
    '''    stage_bin = next(
        (f for f in stage_dir.rglob(recipe.name) if f.is_file() and "DEBIAN" not in f.parts and f.name == recipe.name),
        None,
    )
    if stage_bin and stage_bin.exists():
        bin_target = bin_dir / recipe.name
        shutil.copy2(stage_bin, bin_target)
        bin_target.chmod(0o755)''',
    '''    stage_bin = next(
        (f for f in stage_dir.rglob(recipe.name) if f.is_file() and "DEBIAN" not in f.parts and f.name == recipe.name),
        None,
    )
    if stage_bin and stage_bin.exists():
        bin_target = bin_dir / recipe.name
        shutil.copy2(stage_bin, bin_target)
        bin_target.chmod(0o755)
    else:
        # If the binary wasn't found directly, it might be in an overarching `bin` directory
        bin_dir_path = stage_dir / "data" / "data" / "com.termux" / "files" / "usr" / "bin"
        if bin_dir_path.exists():
            bin_target_alt = bin_dir_path / recipe.name
            if bin_target_alt.exists():
                bin_target = bin_dir / recipe.name
                shutil.copy2(bin_target_alt, bin_target)
                bin_target.chmod(0o755)'''
)

Path("scripts/core/npm.py").write_text(npm_py)
