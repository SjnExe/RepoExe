import re

with open("packages/libandroid-tools/build.yml", "r") as f:
    content = f.read()

content = content.replace("version: 16.0.0", "version: 16.0.0_r4")
content = content.replace("revision: 4", "revision: 0")
content = content.replace('PKG_GIT_BRANCH="android-${version}_r${revision}"', 'PKG_GIT_BRANCH="android-${version//_r/_r}"')

with open("packages/libandroid-tools/build.yml", "w") as f:
    f.write(content)

with open("packages/aapt2/build.yml", "r") as f:
    content = f.read()

content = content.replace("version: 16.0.0", "version: 16.0.0_r4")
content = content.replace("revision: 4", "revision: 0")
content = content.replace('PKG_GIT_BRANCH="android-${version}_r${revision}"', 'PKG_GIT_BRANCH="android-${version//_r/_r}"')

with open("packages/aapt2/build.yml", "w") as f:
    f.write(content)
