function textElement(value: string) {
  return ["$", "p", null, { children: [value] }];
}

function itemElement(values: string[]) {
  return ["$", "div", null, { children: values.map(textElement) }];
}

function flight(rows: Array<[string, unknown]>): string {
  return rows.map(([id, value]) => `${id}:${JSON.stringify(value)}`).join("\n");
}

const profileStream = flight([
  ["1", textElement("Vishnu Example")],
  ["2", textElement("Software Engineer building agentic systems")],
  ["3", textElement("Example Labs · Example Institute")],
  ["4", textElement("Bengaluru, Karnataka, India")],
  ["5", textElement("Contact info")],
  ["6", textElement("About")],
  ["7", textElement("I build reliable products and evaluation systems for agentic software.")],
  ["8", { payload: { vanityName: "vishnu-example", profileId: "profile-example" } }],
  ["9", {
    image: "https://media.example.test/profile-displayphoto-scale_400_400/example.jpg",
  }],
]);

export const profileHtml = [
  "<!doctype html><html><head><title>Vishnu Example | LinkedIn</title></head><body>",
  `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([profileStream])};</script>`,
  "</body></html>",
].join("");

const liveShapedProfileStream = flight([
  ["1", ["$", "div", null, { children: [
    textElement("They/Them"),
    textElement("· 1st"),
    textElement("Applied AI Engineer"),
    textElement("Example Company"),
    textElement("Example City, India"),
    textElement("·"),
    textElement("Contact info"),
    {
      source: {
        renderPayload: {
          rootUrl: "https://media.example.test/profile-displayphoto-shrink_",
          imageRenditions: [
            { width: 100, height: 100, suffixUrl: "100_100/example-small.jpg" },
            { width: 400, height: 400, suffixUrl: "400_400/example-large.jpg" },
          ],
        },
      },
    },
  ] }]],
  ["2", textElement("Example Person")],
  ["3", { payload: { vanityName: "example-person", profileId: "profile-live-shaped" } }],
]);

export const liveShapedProfileHtml = [
  "<!doctype html><html><head><title>Example Person | LinkedIn</title></head><body>",
  `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([liveShapedProfileStream])};</script>`,
  "</body></html>",
].join("");

const rootImageProfileStream = flight([
  ["0", ["$", "main", null, { children: [{
    source: {
      renderPayload: {
        rootUrl: "https://media.example.test/profile-displayphoto-shrink_",
        imageRenditions: [
          { width: 100, height: 100, suffixUrl: "100_100/root-small.jpg" },
          { width: 400, height: 400, suffixUrl: "400_400/root-large.jpg" },
        ],
      },
    },
  }] }]],
  ["1", itemElement([
    "Root Image Engineer",
    "Example Company",
    "Example City, India",
    "Contact info",
  ])],
  ["2", textElement("Root Image Person")],
  ["3", { payload: { vanityName: "root-image-person", profileId: "profile-root-image" } }],
]);

export const rootImageProfileHtml = [
  "<!doctype html><html><head><title>Root Image Person | LinkedIn</title></head><body>",
  `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([rootImageProfileStream])};</script>`,
  "</body></html>",
].join("");

const framedImageProfileStream = flight([
  ["0", ["$", "main", null, { children: [{
    source: {
      renderPayload: {
        rootUrl: "https://media.example.test/profile-displayphoto-shrink_",
        imageRenditions: [
          { width: 100, height: 100, suffixUrl: "100_100/fallback-small.jpg" },
          { width: 400, height: 400, suffixUrl: "400_400/fallback-large.jpg" },
        ],
      },
    },
  }] }]],
  ["1", ["$", "div", null, { children: [
    textElement("Framed Image Engineer"),
    textElement("Example Company"),
    textElement("Example City, India"),
    textElement("Contact info"),
    {
      source: {
        renderPayload: {
          rootUrl: "https://media.example.test/profile-framedphoto-shrink_",
          imageRenditions: [
            { width: 100, height: 100, suffixUrl: "100_100/framed-small.jpg" },
            { width: 560, height: 560, suffixUrl: "560_560/framed-large.jpg" },
          ],
        },
      },
    },
  ] }]],
  ["2", textElement("Framed Image Person")],
  ["3", { payload: { vanityName: "framed-image-person", profileId: "profile-framed-image" } }],
]);

export const framedImageProfileHtml = [
  "<!doctype html><html><head><title>Framed Image Person | LinkedIn</title></head><body>",
  `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([framedImageProfileStream])};</script>`,
  "</body></html>",
].join("");

const lazyAboutProfileStream = flight([
  ["0", ["$", "main", null, { children: [
    itemElement([
      "Lazy About Engineer",
      "Example Company",
      "Example City, India",
      "Contact info",
    ]),
    ["$", "LazyCard", "profile-about", {
      componentKey: "profileCardsAboveActivityTopcardOnlyexample-person",
      children: ["$", "LazyRender", "profile-about", { initialContent: "$2" }],
    }],
  ] }]],
  ["2", ["$", "div", null, {
    screenId: "com.linkedin.sdui.flagshipnav.profile.Profile",
    children: [],
    action: {
      content: {
        $case: "asyncContent",
        asyncContent: {
          newComponentId: "com.linkedin.sdui.profile.card.about",
          requestedArguments: {
            requestedStateKeys: [],
            payload: { vanityName: "lazy-about-person" },
            requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
          },
        },
      },
    },
  }]],
  ["3", { payload: { vanityName: "lazy-about-person", profileId: "profile-lazy-about" } }],
]);

export const lazyAboutProfileHtml = [
  "<!doctype html><html><head><title>Lazy About Person | LinkedIn</title></head><body>",
  `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([lazyAboutProfileStream])};</script>`,
  "</body></html>",
].join("");

export const lazyAboutShapeDriftProfileHtml = lazyAboutProfileHtml.replace(
  '\\"$case\\":\\"asyncContent\\"',
  '\\"$case\\":\\"unknownContent\\"',
);

export const lazyAboutComponentFlight = flight([
  ["0", itemElement([
    "About",
    "I build dependable systems and test them with carefully designed, reproducible evaluations.",
    "Top skills",
    "Systems Design",
  ])],
]);

export const explicitlyEmptyAboutComponentFlight = flight([
  ["0", ["$", "div", null, {
    "data-sdui-component": "profile-cards",
    children: [false, [
      ["$", "div", null, { children: [] }],
    ]],
  }]],
]);

export const multiParagraphAboutComponentFlight = flight([
  ["0", itemElement([
    "About",
    "I build dependable systems for high-stakes workflows.",
    "I validate those systems with deterministic evaluations and privacy-minimized live checks.",
    "I document residual risks before recommending a release.",
    "Top skills",
    "Systems Design",
    "Evaluation",
  ])],
]);

export const shortAboutComponentFlight = flight([
  ["0", itemElement([
    "About",
    "Build. Learn. Share.",
  ])],
]);

export const emptyChildrenAboutComponentFlight = flight([
  ["0", ["$", "LazyCard", null, {
    children: [],
    initialContent: itemElement([
      "About",
      "A dedicated initial-content biography remains authoritative when children is empty.",
    ]),
  }]],
]);

export const singleCharacterAboutComponentFlight = flight([
  ["0", itemElement(["About", "X"])],
]);

export const boundaryWordAboutComponentFlight = flight([
  ["0", itemElement(["About", "Featured"])],
]);

export const internationalAboutComponentFlight = flight([
  ["0", itemElement([
    "About",
    "  Build carefully.  ",
    "مرحبا بالعالم",
    "構築と検証",
    "Cafe\u0301\u200B 🚀",
    "Top skills",
    "Testing",
  ])],
]);

export const whitespaceOnlyAboutComponentFlight = flight([
  ["0", itemElement(["About", "  \n\t  "])],
]);

export const duplicateSkillRowsFlight = flight([
  ["4", textElement("TypeScript")],
  ["5", textElement("TypeScript")],
  ["6", textElement("Rust")],
]);

export const renewedCertificationsFlight = flight([
  ["4", itemElement([
    "Cloud Engineer",
    "Example Cloud",
    "Issued Jan 2024",
    "Credential ID RENEWAL-ONE",
  ])],
  ["5", itemElement([
    "Cloud Engineer",
    "Example Cloud",
    "Issued Jan 2026",
    "Credential ID RENEWAL-TWO",
  ])],
]);

export const sameCoreExperienceFlight = flight([
  ["4", itemElement([
    "Advisor",
    "Example Company · Contract",
    "Jan 2025 - Present",
    "Remote",
  ])],
  ["6", itemElement([
    "Advisor",
    "Example Company · Contract",
    "Jan 2025 - Present",
    "Example City · Hybrid",
  ])],
]);

const unsafeImageProfileStream = flight([
  ["0", ["$", "main", null, { children: [{
    source: {
      renderPayload: {
        rootUrl: "javascript:profile-framedphoto-",
        imageRenditions: [{ width: 400, suffixUrl: "unsafe" }],
      },
    },
  }] }]],
  ["1", itemElement(["Security Engineer", "Example City", "Contact info"])],
  ["2", { payload: { vanityName: "unsafe-image", profileId: "profile-unsafe-image" } }],
]);

export const unsafeImageProfileHtml = [
  "<!doctype html><html><head><title>Unsafe Image | LinkedIn</title></head><body>",
  `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([unsafeImageProfileStream])};</script>`,
  "</body></html>",
].join("");

const partialImageProfileStream = flight([
  ["0", ["$", "main", null, { children: [{
    source: {
      renderPayload: {
        rootUrl: "https://media.example.test/profile-displayphoto-shrink_",
        imageRenditions: [
          { width: 100 },
          { width: 200, suffixUrl: "not a valid URL" },
          { width: 400, suffixUrl: "400_400/valid.jpg" },
        ],
      },
    },
  }] }]],
  ["1", itemElement(["Image Engineer", "Example City", "Contact info"])],
  ["2", { payload: { vanityName: "partial-image", profileId: "profile-partial-image" } }],
]);

export const partialImageProfileHtml = [
  "<!doctype html><html><head><title>Partial Image | LinkedIn</title></head><body>",
  `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([partialImageProfileStream])};</script>`,
  "</body></html>",
].join("");

export const cyclicFlight = flight([
  ["0", ["$", "div", null, { children: "$1" }]],
  ["1", ["$", "div", null, { children: "$0" }]],
]);

export const undatedExperienceFlight = flight([
  ["0", itemElement([
    "Experience",
    collectionMarker("undated-independent"),
    "Independent Researcher",
  ])],
]);

export const delimiterCompanyExperienceFlight = flight([
  ["0", itemElement([
    "Experience",
    collectionMarker("delimiter-company"),
    "Research Engineer",
    "Research · Development Labs · Contract",
    "Remote",
    "Designed a deterministic evaluation system without relying on a date range.",
  ])],
]);

export const careerBreakExperienceFlight = flight([
  ["0", itemElement([
    "Experience",
    collectionMarker("career-break"),
    "Career Break",
    "Jan 2024 - Jun 2024 · 6 mos",
    "Focused on personal development and independent study.",
  ])],
]);

export const plainDescriptionExperienceFlight = flight([
  ["4", itemElement([
    "Platform Engineer",
    "Example Systems · Full-time",
    "Jan 2025 - Present",
    "Remote",
  ])],
  ["5", itemElement(["Designed resilient systems without bullet prefixes."])],
]);

export const multipleDegreesEducationFlight = flight([
  ["0", itemElement([
    "Education",
    collectionMarker("degree-one"),
    "Example University",
    "Bachelor of Arts, Economics, Mathematics",
    "2018 – 2022",
    collectionMarker("degree-two"),
    "Example University",
    "Master of Science, Computer Science",
    "2022 – 2024",
  ])],
]);

export function skillsPageFlight(prefix: string, count = 10): string {
  return flight(Array.from({ length: count }, (_, index) => [
    (index + 4).toString(16),
    textElement(`${prefix}-${index + 1}`),
  ]));
}

export function partiallyParsedSkillsFlight(declaredCount: number, parsedCount: number): string {
  return flight([
    ["0", itemElement([
      "Skills",
      ...Array.from({ length: declaredCount }, (_, index) => collectionMarker(`skill-${index}`)),
    ])],
    ...Array.from({ length: parsedCount }, (_, index) => [
      (index + 4).toString(16),
      textElement(`parsed-skill-${index + 1}`),
    ] as [string, unknown]),
  ]);
}

export const experienceFlight = flight([
  ["4", itemElement([
    "Senior Software Engineer",
    "Example Labs · Full-time",
    "Jan 2024 - Present · 2 yrs 8 mos",
    "Bengaluru, India · Hybrid",
  ])],
  ["5", itemElement(["• Built dependable agent systems.", "• Added deterministic evaluations."])],
]);

export const groupedExperienceFlight = flight([
  ["0", itemElement([
    "Experience",
    collectionMarker("grouped-company"),
    "Example Company",
    "Full-time · 7 yrs",
    "Example Product Group",
    "Senior Product Manager",
    "Jan 2023 - Present · 3 yrs",
    "Remote",
    "Led the current product portfolio.",
    "Skills:",
    "Product Strategy, Leadership",
    "Product Manager",
    "Jan 2020 - Dec 2022 · 3 yrs",
    "Example City, India · On-site",
    "Built the first version of the product.",
    "Skills:",
    "Product Management",
  ])],
  ["4", itemElement([
    "Senior Product Manager",
    "Example Company · Full-time",
    "Jan 2023 - Present · 3 yrs",
    "Remote",
  ])],
  ["6", textElement("Experience")],
]);

export const descriptionWithoutLocationExperienceFlight = flight([
  ["0", itemElement([
    "Experience",
    collectionMarker("description-without-location"),
    "Research Engineer",
    "Example Research · Contract",
    "Jan 2025 - Jun 2025 · 6 mos",
    "Designed the first evaluation suite.",
    "Published reproducible results.",
  ])],
  ["4", itemElement([
    "Research Engineer",
    "Example Research · Contract",
    "Jan 2025 - Jun 2025 · 6 mos",
  ])],
  ["6", textElement("Experience")],
]);

export const educationFlight = flight([
  ["0", itemElement([
    JSON.stringify({ key: "section-metadata", semanticId: "" }),
    "Education",
    JSON.stringify({
      key: "entity-collection-item--20586538",
      semanticId: "entity-collection-item--20586538",
    }),
  ])],
  ["4", itemElement([
    "Example Institute",
    "Bachelor of Technology, Computer Science",
    "2018 – 2022",
  ])],
]);

export const skillsFlight = flight([
  ["4", itemElement(["TypeScript", "Senior Software Engineer at Example Labs"])],
  ["5", itemElement(["Distributed Systems"])],
  ["6", textElement("TypeScript")],
]);

export const certificationsFlight = flight([
  ["4", itemElement([
    "Cloud Engineer",
    "Example Cloud",
    "Issued Jan 2025",
    "Credential ID EXAMPLE-123",
  ])],
  ["5", textElement("Cloud Engineer")],
]);

function collectionMarker(id: string) {
  return JSON.stringify({
    key: `entity-collection-item-${id}`,
    semanticId: `entity-collection-item-${id}`,
    threadlineDecoration: null,
  });
}

function credentialLinkElement(target: string) {
  const url = new URL("https://www.linkedin.com/safety/go/");
  url.searchParams.set("url", target);
  url.searchParams.set("urlhash", "test");
  return ["$", "a", null, {
    children: ["Show credential"],
    action: { value: { content: { url: { urlValue: { url: url.toString() } } } } },
  }];
}

export const unsafeCredentialFlight = flight([
  ["0", ["$", "div", null, { children: [
    ...[
      "Licenses & certifications",
      collectionMarker("unsafe-one"),
      "Security Certificate",
      "Example Issuer",
      "Issued Jan 2025",
    ].map(textElement),
    credentialLinkElement("javascript:alert(1)"),
    ...[
      collectionMarker("unsafe-two"),
      "Identity Certificate",
      "Example Issuer",
      "Issued Feb 2025",
    ].map(textElement),
    credentialLinkElement("https://user:password@credentials.example.test/two"),
  ] }]],
]);

export const liveShapedCertificationsFlight = flight([
  ["0", ["$", "div", null, { children: [
    ...[
      "Licenses & certifications",
      collectionMarker("one"),
      "Machine Learning Associate",
      "Example Cloud",
      "Issued Nov 2024 · Expires Nov 2026",
    ].map(textElement),
    credentialLinkElement("https://credentials.example.test/cert/one"),
    ...[
      collectionMarker("two"),
      "Generative AI Professional",
      "Example Cloud",
      "Issued Oct 2024",
    ].map(textElement),
    credentialLinkElement("http://credentials.example.test/cert/two"),
    ...[
      "Skills:",
      "Artificial Intelligence, Machine Learning",
    ].map(textElement),
  ] }]],
  ["6", textElement("Licenses & certifications")],
  ["8", textElement("Machine Learning Associate")],
  ["9", textElement("Example Cloud")],
  ["a", textElement("Issued Nov 2024 · Expires Nov 2026")],
  ["c", textElement("Generative AI Professional")],
  ["d", textElement("Example Cloud")],
  ["e", textElement("Issued Oct 2024")],
]);

export const liveShapedEducationWithoutDatesFlight = flight([
  ["0", itemElement([
    "Education",
    collectionMarker("education-one"),
    "Example University",
    "BS, Quantitative Sciences; BA, Economics & Mathematics",
    "Activities and societies:",
    "- Student Council",
    collectionMarker("education-two"),
    "Example Summer School",
    "Summer Program, Product Development",
    collectionMarker("education-three"),
    "Example International School",
    "Cambridge AS & A Levels",
    "Apr 2018",
    "Grade: 94%",
    "0.1.50904-1",
  ])],
  ["6", textElement("Education")],
  ["8", itemElement([
    "Example University",
    "BS, Quantitative Sciences; BA, Economics & Mathematics",
  ])],
]);

export const liveShapedLanguagesFlight = flight([
  ["0", itemElement([
    "Languages",
    collectionMarker("language-one"),
    "English",
    "Native or bilingual proficiency",
    collectionMarker("language-two"),
    "Hindi",
    "Native or bilingual proficiency",
    "0.1.50904-1",
  ])],
  ["6", textElement("Languages")],
  ["7", textElement("English")],
  ["8", textElement("Native or bilingual proficiency")],
  ["9", textElement("Hindi")],
  ["a", textElement("Native or bilingual proficiency")],
]);

export const languagesFlight = flight([
  ["4", itemElement(["English", "Professional working proficiency"])],
]);

export const emptyFlight = "0:" + JSON.stringify(textElement("Nothing to see for now"));

export const responseShapeDriftFlight = flight([
  ["0", itemElement(["Experience", "Unknown response wrapper"])],
]);
