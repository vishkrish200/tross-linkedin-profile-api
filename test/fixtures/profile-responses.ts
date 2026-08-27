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

export const experienceFlight = flight([
  ["4", itemElement([
    "Senior Software Engineer",
    "Example Labs · Full-time",
    "Jan 2024 - Present · 2 yrs 8 mos",
    "Bengaluru, India · Hybrid",
  ])],
  ["5", itemElement(["• Built dependable agent systems.", "• Added deterministic evaluations."])],
]);

export const educationFlight = flight([
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

export const languagesFlight = flight([
  ["4", itemElement(["English", "Professional working proficiency"])],
]);

export const emptyFlight = "0:" + JSON.stringify(textElement("Nothing to see for now"));
