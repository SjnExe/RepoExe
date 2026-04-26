import re

with open("packages/libandroid-tools/build.yml", "r") as f:
    content = f.read()

content = content.replace('PKG_GIT_BRANCH="android-${version//_r/_r}"', 'PKG_GIT_BRANCH="android-${version}"')

with open("packages/libandroid-tools/build.yml", "w") as f:
    f.write(content)

with open("packages/aapt2/build.yml", "r") as f:
    content = f.read()

content = content.replace('PKG_GIT_BRANCH="android-${version//_r/_r}"', 'PKG_GIT_BRANCH="android-${version}"')

with open("packages/aapt2/build.yml", "w") as f:
    f.write(content)
