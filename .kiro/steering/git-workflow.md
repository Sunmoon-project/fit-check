---
inclusion: always
---

# Git 작업 방식

모든 작업은 기능별 브랜치에서 하고, 끝나면 `develop`에 머지합니다. `develop`이나 `main`에 직접 커밋하지 않습니다.

## 순서

1. 최신 `develop`에서 브랜치를 만듭니다.
   - `git switch develop && git pull origin develop`
   - `git switch -c <종류>/<짧은-설명>`
2. 브랜치에서 작업하고 커밋합니다. 커밋 메시지는 `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:` 접두사를 씁니다.
3. 머지 전에 검증합니다. 하나라도 실패하면 머지하지 않습니다.
   - `npm run build`
   - `npm run build:file`
   - `npm run smoke`
4. `develop`에 머지하고 푸시합니다.
   - `git switch develop && git pull origin develop`
   - `git merge --no-ff <브랜치>`
   - `git push origin develop`
5. 머지한 브랜치는 로컬에서 지웁니다(`git branch -d <브랜치>`). 원격 브랜치는 사용자가 요청할 때만 지웁니다.

## 브랜치 이름

- `feature/` 새 기능 (예: `feature/wardrobe-saved-recommendation`)
- `fix/` 버그 수정
- `style/` 디자인·문구 수정
- `chore/` 설정, 문서, 빌드

요청 하나에 기능이 여러 개면 기능마다 브랜치를 따로 만듭니다.

## 주의

- `main`에는 사용자가 요청할 때만 머지합니다.
- force push, `reset --hard`, 원격 브랜치 삭제는 사용자가 요청할 때만 합니다.
- `.agents/`, `.env`는 커밋하지 않습니다.
- 작업을 시작할 때 `git status`로 다른 세션이 남긴 미커밋 변경이 있는지 확인합니다. 있으면 덮어쓰지 말고 사용자에게 먼저 알립니다.
