# 대시보드 디자인 개편 전 원본 (v1)

- 백업 시점 커밋: b030968 (claude/semiconductor-news-kakao-sender-1vfo23 에 반영된 #66 이후)
- 복원 방법 1(가장 쉬움): site/dashboard.html 에서 `dashboard.theme.css` 링크 한 줄만 삭제하면 이전 디자인으로 돌아갑니다(새 요소는 테마 파일 없이는 숨겨집니다).
- 복원 방법 2: 이 폴더의 파일을 site/ 로 되돌려 복사하거나, 개편 커밋을 git revert 합니다.
