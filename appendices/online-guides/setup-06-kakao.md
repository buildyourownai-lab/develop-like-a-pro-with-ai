# 6장 · Kakao Local API 준비

책의 상세 지원 자료입니다. 책에 없는 추가 안내는 필요할 때만 사용합니다. 화면과 정책의 과거 확인 기록은 현재 지원·요금·실행 성공을 보증하지 않습니다. 현재 계정의 공식 안내를 함께 확인하세요.

## Kakao REST API 키를 준비합니다

이제 Kakao Local API를 사용할 준비를 합니다.

**Kakao Developers**  
https://developers.kakao.com

**Kakao Local API 공식 문서**  
https://developers.kakao.com/docs/ko/local/dev-guide

~~~prompt
Kakao Local API를 사용할 거야.
내가 직접 해야 하는 과정만 알려줘.
Kakao Developers에서 필요한 준비를 시작해서 이번 실습에 사용할 키를 확인할 때까지 처음 하는 사람도 따라 할 수 있게 설명해줘.
아직 코드는 작성하지 마.
~~~

Kakao Developers에 로그인하고 이번 실습에서 사용할 애플리케이션을 준비합니다.

애플리케이션을 만든 뒤 **플랫폼 키** 화면으로 이동합니다.

Kakao에서는 API를 사용하는 방법에 따라 REST API 키, JavaScript 키, 네이티브 앱 키 같은 여러 종류의 플랫폼 키를 제공합니다.

이번 프로젝트의 프로그램에서 Kakao Local API를 호출할 때는
**REST API 키**를 사용합니다.

![Kakao Developers의 실습용 앱과 REST API 키 위치](https://www.studyailab.com/develop/guides/chapter-06/screen-06-07-08-kakao-app-and-rest-key-location.png)

[화면 6-7 | 생성된 실습용 앱의 이름과 역할을 확인한 뒤, 같은 앱의 플랫폼 키 화면에서 REST API 키 위치를 찾습니다. 실제 값 영역은 프레임에서 제외했습니다.]

**REST API 키가 보이면 Kakao 준비도 끝났습니다.**

이제 필요한 인증정보 두 개가 준비됐습니다.

- 국토교통부 서비스키
- Kakao REST API 키

이제 프로그램이 이 두 값을 안전하게 사용할 수 있도록 준비해야 합니다.

---
