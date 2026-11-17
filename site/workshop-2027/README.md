# 2027 팀 아이디어 워크숍 (3명)

GitHub Pages: `https://captaincatb-web.github.io/Sangsaengnews/workshop-2027/`

## 제공 기능

- 3명별 2026년 Review: 잘한 점 1개 / 문제점 1개
- 2027년 업무 개선 제안 2건 이상, 공감 투표, 최종안 선정
- 2027년 신규사업 2건 이상, 5개 타당성 검토: 필요성, 당사·협력사 기여, 실행 가능성, 실행 방안, 실행 후 변화
- TXT, JSON 내보내기 / 인쇄 (PDF 저장) / 브라우저 자동 저장
- 공유 DB를 설정하면 **3명만 이메일 인증 후 접근 가능**, 여러 브라우저 간 동기화, 경합 제어 (revision CAS)

## 데이터 저장 모드

1. **기본**: 현재 브라우저 `localStorage` 자동 저장. 다른 기기와 공유되지 않음.
2. **공유 저장(별도 설정 필요)**: Supabase 무료 프로젝트 + 이메일 OTP 로그인 + PostgreSQL RLS.

GitHub Pages는 정적 파일을 호스팅할 뿐 브라우저 작성 내용을 서버에 저장하지 않습니다. Supabase가 미설정인 상태에서 '공유 저장 완료'라고 표시하지 않습니다.

## Supabase 연결 절차

1. Supabase에서 새 프로젝트를 생성합니다 (DB 프로젝트의 비용·한도는 실제 서비스 약관을 확인하세요).
2. Supabase SQL Editor에서 `schema.sql`을 열고 3개의 `memberN@example.com`을 실제 참석자 이메일로 바꾼 다음 실행합니다. **실제 이메일을 GitHub 저장소에 커밋하지 마세요.**
3. Supabase Authentication > Providers에서 Email OTP 인증 가능 여부를 확인합니다.
4. Supabase Authentication > URL Configuration에서 Site URL과 Redirect URL에 `https://captaincatb-web.github.io/Sangsaengnews/workshop-2027/`를 추가합니다.
5. `config.js`의 `supabaseUrl`, `supabaseAnonKey`에 Supabase 프로젝트 URL과 publishable(또는 legacy anon) 키를 입력해 저장소에 배포합니다. 공개 가능한 키만 사용하고 **service_role/secret key는 절대 웹에 넣지 마세요**.
6. 세 참석자가 각자의 이메일로 로그인합니다. 성공하면 상단에 '공유 저장 완료'가 표시됩니다.
7. 서로 다른 브라우저 2개로 제안 작성 및 동기화 동작을 검증합니다.

### 주의사항

- GitHub 저장소가 공개이므로 HTML·SQL·설정 파일은 누구나 볼 수 있습니다. **인증 정보(사용자별 이메일, 관리자 키, 비밀번호)나 업무 자료를 GitHub 소스에 직접 포함하지 마세요.**
- Supabase 프로젝트는 RLS로 보호하되, 외부 클라우드 사용이 사내 정보보호 규정상 허용되는 경우에만 사용하세요.
- 세 명 모두 `workshop_states`에 대한 읽기·쓰기 권한을 가집니다. UI에서는 현재 작성자를 로그인 이메일로 고정하지만, 공동 작업의 최종안·아이디어를 서로 검토하는 구조입니다.
- 충돌 해결은 작성 시각 기반 필드 병합 및 revision 조건부 업데이트로 처리합니다. 서로 다른 기기에서 같은 제안을 동시에 고치는 것은 가급적 피하세요.
- Supabase 연결이 끊겨도 브라우저 백업은 남지만, 온라인 저장 실패가 발생하면 JSON 백업을 내려받으세요.
- 기존 버전의 JSON 파일 병합은 **브라우저 저장 모드에서만** 지원합니다.