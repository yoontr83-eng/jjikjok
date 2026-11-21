export default async function handler(req, res) {
  // CORS 허용 설정
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." });
  }

  try {
    const { images, text, subject } = req.body || {};
    const subjectName = subject || "국어";
    const imageList = Array.isArray(images) ? images.slice(0, 3) : [];

    if (imageList.length === 0 && !text) {
      return res.status(400).json({ error: "프린트 사진(1~3장)이나 텍스트를 입력해 주세요." });
    }

    const subjectGuides = {
      "국어": "국어 영역(문법·문학·독서) 특성에 맞춰 음운 변동/품사 통용/문장의 짜임/중세 국어 규칙이 '왜 그렇게 적용되는지' 문법적 원리를 설명하고, 구체적 단어나 문장 예시를 단계별로 분석하세요. 중세 국어 옛한글을 표기할 때는 절대 HWP 비표준 코드(PUA)를 쓰지 말고 반드시 표준 유니코드 옛한글 첫가끝 조합형으로 표기하세요.",
      "영어": "영어 영역 특성에 맞춰 지문의 논리적 인과 흐름이나 내신 어법(수일치·분사구문·관계사 what vs that)의 문장 구조 원리를 1:1 과외처럼 명쾌하게 설명하고 실제 문장 예시로 판별 과정을 보여주세요.",
      "통합과학": "통합과학 특성에 맞춰 물리·화학·생명·지구과학 현상이 '왜 일어나는지' 과학적 인과관계를 논리적으로 풀어 설명하고, 상태 조건·그래프 해석·예외 사례를 구체적 예시로 적용해 보여주세요.",
      "통합사회": "통합사회 특성에 맞춰 유사 개념(자유권 vs 사회권, 기회비용 vs 매몰비용 등)의 등장 배경과 판단 기준을 논리적으로 설명하고, 실제 사례나 계산 과정을 단계별로 풀이해 보여주세요."
    };

    const systemPrompt = `당신은 대한민국 고등학교 내신 출제 원리를 꿰뚫고 있으며, 단순 요약이 아니라 학생이 개념의 근본 원리를 100% 납득할 수 있도록 논리적으로 설명해 주는 [${subjectName}] 베테랑 1타 강사입니다.
학생이 업로드한 1~3장 세트의 학교 수업 프린트 이미지(또는 필기 텍스트) 전체 흐름을 하나로 통합 분석하여 벼락치기 자료 4종 세트를 JSON으로 출력하세요.

[과목 특화 지침 - ${subjectName}]
${subjectGuides[subjectName] || ""}

[이해 중심 설명 및 분석 규칙 - 매우 중요]
1. 억지스러운 일상 비유나 유치한 은유는 절대 사용하지 마세요. 대신 고등학생이 스스로 고개를 끄덕이며 이해할 수 있도록 '왜 그런지(인과관계·작동 원리)'와 '어떻게 적용하는지(판별 과정)'를 명확하고 친절한 구어체(~입니다 / ~하기 때문입니다)로 설명하세요.
2. 여러 장(2~3장)이 업로드된 경우 각 페이지의 내용을 따로 끊지 말고 하나의 단원 체계로 유기적으로 연결해 정리하세요.
3. 손글씨 별표(★), 밑줄, 형광펜, '중요/주의/함정' 표시가 있다면 최우선 출제 포인트(teacherPicks)로 뽑아내세요.
4. summaryCards는 3~5개의 핵심 개념 카드로 구성하되, 각 카드마다 반드시 아래 세 항목을 명확히 구분해 작성하세요:
   - coreSummary: 시험 답안용 핵심 개념 요약 (조건·규칙·공식 정리)
   - whyExplanation: 단순 요약을 반복하지 말고, "왜 이런 규칙/현상이 성립하는지" 근본 원리와 배경 이유를 1:1 과외 선생님처럼 3~4문장으로 깊이 있고 알기 쉽게 풀어쓴 설명
   - stepByStepExample: 구체적인 실제 사례나 문제 예시 1~2개를 가져와 '① 조건 확인 → ② 원리 적용 → ③ 결론' 순서로 사고 과정을 단계별 해부한 풀이
5. blankItems는 핵심 암기 문장 4개를 작성하되, 빈칸으로 뚫을 핵심 키워드만 {{정답}} 형식으로 감싸세요.
6. oxQuiz는 내신 시험에서 학생들이 가장 많이 낚이는 말장난 함정 선지를 섞어 5문제를 출제하고, 명확한 해설을 제공하세요.
7. audioScript는 시험 당일 등굣길에 음성으로 듣는 대본(250~330자)입니다. 기계음처럼 들리지 않도록 괄호나 특수기호를 빼고, 짧은 구어체 문장과 자연스러운 마침표·쉼표로 작성하세요.`;

    const parts = [];
    imageList.forEach((img, idx) => {
      if (img && img.base64 && img.mimeType) {
        parts.push({ text: `[${subjectName} 프린트 세트 ${idx + 1}쪽 이미지]` });
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64
          }
        });
      }
    });

    parts.push({
      text: text
        ? `위 [${subjectName}] 프린트 이미지(${imageList.length}장)와 아래 필기 내용을 종합해서 억지 비유 없이 원리 이해 풀이와 예시 단계별 해부가 담긴 벼락치기 4종 세트를 만들어줘:\n${text}`
        : `첨부된 총 ${imageList.length}장 세트의 [${subjectName}] 수업 프린트 사진을 순서대로 통합 분석해서, 억지 비유 없이 원리 이해 풀이와 예시 단계별 해부가 담긴 벼락치기 4종 세트를 만들어줘.`
    });

    // 무료 티어 지원 최신 모델 (gemini-4-hydrogen)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          maxOutputTokens: 8192,
          thinkingConfig: {
            thinkingLevel: "medium"
          },
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              subjectTitle: { type: "STRING" },
              teacherPicks: { type: "ARRAY", items: { type: "STRING" } },
              summaryCards: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    coreSummary: { type: "STRING" },
                    whyExplanation: { type: "STRING" },
                    stepByStepExample: { type: "STRING" },
                    isStarred: { type: "BOOLEAN" }
                  },
                  required: ["title", "coreSummary", "whyExplanation", "stepByStepExample", "isStarred"]
                }
              },
              blankItems: { type: "ARRAY", items: { type: "STRING" } },
              oxQuiz: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    question: { type: "STRING" },
                    answer: { type: "STRING" },
                    trapExplanation: { type: "STRING" }
                  },
                  required: ["question", "answer", "trapExplanation"]
                }
              },
              audioScript: { type: "STRING" }
            },
            required: ["subjectTitle", "teacherPicks", "summaryCards", "blankItems", "oxQuiz", "audioScript"]
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: "AI 분석 중 오류가 발생했습니다.", detail: errText });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(500).json({ error: "AI 응답이 비어 있습니다." });
    }

    return res.status(200).json(JSON.parse(rawText));
  } catch (error) {
    return res.status(500).json({ error: "서버 처리 중 예외가 발생했습니다.", message: error.message });
  }
}