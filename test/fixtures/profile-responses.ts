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

export const liveShapedCertificationsFlight = flight([
  ["0", itemElement([
    "Licenses & certifications",
    collectionMarker("one"),
    "Machine Learning Associate",
    "Example Cloud",
    "Issued Nov 2024 · Expires Nov 2026",
    collectionMarker("two"),
    "Generative AI Professional",
    "Example Cloud",
    "Issued Oct 2024",
    "Skills:",
    "Artificial Intelligence, Machine Learning",
  ])],
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
