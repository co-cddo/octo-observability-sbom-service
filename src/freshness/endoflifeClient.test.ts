import { findCycleForVersion } from "./endoflifeClient";
import { EndOfLifeCycle } from "./types";

const nodeCycles: EndOfLifeCycle[] = [
  {
    cycle: "22",
    releaseDate: "2024-04-24",
    eol: "2027-04-30",
    lts: false,
    latest: "22.12.0",
    latestReleaseDate: "2025-01-01",
  },
  {
    cycle: "20",
    releaseDate: "2023-10-24",
    eol: "2026-04-30",
    lts: "2023-10-24",
    latest: "20.18.0",
    latestReleaseDate: "2024-10-01",
  },
  {
    cycle: "18",
    releaseDate: "2022-04-19",
    eol: "2025-04-30",
    lts: "2022-10-25",
    latest: "18.20.4",
    latestReleaseDate: "2024-08-01",
  },
  {
    cycle: "16",
    releaseDate: "2021-04-20",
    eol: "2023-09-11",
    lts: "2021-10-26",
    latest: "16.20.2",
    latestReleaseDate: "2023-08-08",
  },
];

describe("findCycleForVersion", () => {
  it("matches major version for Node", () => {
    const result = findCycleForVersion(nodeCycles, "20.18.0");
    expect(result?.cycle).toBe("20");
  });

  it("matches with v prefix", () => {
    const result = findCycleForVersion(nodeCycles, "v18.19.1");
    expect(result?.cycle).toBe("18");
  });

  it("returns null for unmatched version", () => {
    const result = findCycleForVersion(nodeCycles, "99.0.0");
    expect(result).toBeNull();
  });

  it("matches major.minor format cycles", () => {
    const springCycles: EndOfLifeCycle[] = [
      {
        cycle: "3.4",
        releaseDate: "2024-11-21",
        eol: "2025-11-21",
        lts: false,
        latest: "3.4.1",
        latestReleaseDate: "2024-12-19",
      },
      {
        cycle: "3.3",
        releaseDate: "2024-05-23",
        eol: "2024-11-21",
        lts: false,
        latest: "3.3.7",
        latestReleaseDate: "2024-12-19",
      },
    ];
    const result = findCycleForVersion(springCycles, "3.3.5");
    expect(result?.cycle).toBe("3.3");
  });
});
