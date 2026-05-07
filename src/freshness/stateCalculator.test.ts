import {
  evaluateWithEndOfLife,
  evaluateWithRegistry,
  computeMajorsBehind,
  computeMinorsBehind,
} from "./stateCalculator";
import { EndOfLifeCycle } from "./types";

describe("computeMajorsBehind", () => {
  it("returns 0 when on latest", () => {
    expect(computeMajorsBehind("5.1.0", "5.2.0")).toBe(0);
  });

  it("returns difference in major versions", () => {
    expect(computeMajorsBehind("4.21.0", "5.1.0")).toBe(1);
    expect(computeMajorsBehind("3.0.0", "5.1.0")).toBe(2);
    expect(computeMajorsBehind("18.19.0", "22.1.0")).toBe(4);
  });

  it("handles v-prefix", () => {
    expect(computeMajorsBehind("v18.0.0", "v22.0.0")).toBe(4);
  });

  it("returns 0 for unparseable versions", () => {
    expect(computeMajorsBehind("latest", "5.0.0")).toBe(0);
  });
});

describe("computeMinorsBehind", () => {
  it("returns minor diff within same major", () => {
    expect(computeMinorsBehind("5.1.0", "5.4.0")).toBe(3);
  });

  it("returns 0 when on different majors", () => {
    expect(computeMinorsBehind("4.21.0", "5.1.0")).toBe(0);
  });

  it("returns 0 when on same minor", () => {
    expect(computeMinorsBehind("5.1.3", "5.1.9")).toBe(0);
  });
});

describe("evaluateWithEndOfLife", () => {
  const activeLtsCycle: EndOfLifeCycle = {
    cycle: "20",
    releaseDate: "2023-10-24",
    eol: "2028-04-30",
    lts: "2023-10-24",
    latest: "20.18.0",
    latestReleaseDate: "2024-10-01",
  };

  const currentCycle: EndOfLifeCycle = {
    cycle: "22",
    releaseDate: "2024-04-24",
    eol: "2027-04-30",
    lts: false,
    latest: "22.12.0",
    latestReleaseDate: "2025-01-01",
  };

  const eolCycle: EndOfLifeCycle = {
    cycle: "16",
    releaseDate: "2021-04-20",
    eol: "2023-09-11",
    lts: "2021-10-26",
    latest: "16.20.2",
    latestReleaseDate: "2023-08-08",
  };

  it("returns green for active LTS", () => {
    const result = evaluateWithEndOfLife(
      "node",
      "20.18.0",
      activeLtsCycle,
      currentCycle,
      null,
    );
    expect(result.state).toBe("green");
    expect(result.ltsStatus).toBe("lts");
  });

  it("returns red for EOL version", () => {
    const result = evaluateWithEndOfLife(
      "node",
      "16.20.2",
      eolCycle,
      currentCycle,
      null,
    );
    expect(result.state).toBe("red");
    expect(result.ltsStatus).toBe("eol");
  });

  it("returns amber when LTS ending within 6 months", () => {
    const endingSoonCycle: EndOfLifeCycle = {
      cycle: "18",
      releaseDate: "2022-04-19",
      eol: new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0],
      lts: "2022-10-25",
      latest: "18.20.0",
      latestReleaseDate: "2024-03-01",
    };
    const result = evaluateWithEndOfLife(
      "node",
      "18.20.0",
      endingSoonCycle,
      currentCycle,
      null,
    );
    expect(result.state).toBe("amber");
    expect(result.ltsStatus).toBe("lts_ending");
  });

  it("returns unknown when no cycle matched", () => {
    const result = evaluateWithEndOfLife(
      "node",
      "99.0.0",
      null,
      currentCycle,
      null,
    );
    expect(result.state).toBe("unknown");
  });

  it("returns unknown when no detected version", () => {
    const result = evaluateWithEndOfLife(
      "node",
      null,
      activeLtsCycle,
      currentCycle,
      null,
    );
    expect(result.state).toBe("unknown");
  });
});

describe("evaluateWithRegistry", () => {
  it("returns green when on latest", () => {
    const result = evaluateWithRegistry("express", "5.1.0", "5.1.0", null);
    expect(result.state).toBe("green");
    expect(result.versionsBehindMajor).toBe(0);
  });

  it("returns green when 1 major behind under 30 days", () => {
    const result = evaluateWithRegistry("express", "4.21.0", "5.1.0", null);
    expect(result.state).toBe("green");
    expect(result.versionsBehindMajor).toBe(1);
    expect(result.firstBehindAt).not.toBeNull();
  });

  it("returns amber when 1 major behind over 30 days", () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86400000);
    const result = evaluateWithRegistry(
      "express",
      "4.21.0",
      "5.1.0",
      thirtyOneDaysAgo,
    );
    expect(result.state).toBe("amber");
  });

  it("returns amber when 2 majors behind", () => {
    const result = evaluateWithRegistry("express", "3.0.0", "5.1.0", null);
    expect(result.state).toBe("amber");
  });

  it("returns red when 3+ majors behind", () => {
    const result = evaluateWithRegistry(
      "govuk-frontend",
      "2.0.0",
      "6.1.0",
      null,
    );
    expect(result.state).toBe("red");
  });

  it("returns red when 2 majors behind over 90 days", () => {
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 86400000);
    const result = evaluateWithRegistry(
      "express",
      "3.0.0",
      "5.1.0",
      ninetyOneDaysAgo,
    );
    expect(result.state).toBe("red");
  });

  it("resets firstBehindAt when caught up", () => {
    const previousBehindAt = new Date(Date.now() - 60 * 86400000);
    const result = evaluateWithRegistry(
      "express",
      "5.1.0",
      "5.1.0",
      previousBehindAt,
    );
    expect(result.firstBehindAt).toBeNull();
    expect(result.state).toBe("green");
  });

  it("returns unknown when no detected version", () => {
    const result = evaluateWithRegistry("express", null, "5.1.0", null);
    expect(result.state).toBe("unknown");
  });

  it("returns unknown when no latest version", () => {
    const result = evaluateWithRegistry("express", "4.21.0", null, null);
    expect(result.state).toBe("unknown");
  });
});
