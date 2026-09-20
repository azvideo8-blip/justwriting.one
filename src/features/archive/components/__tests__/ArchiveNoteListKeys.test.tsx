import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../../../test/utils/render";
import { ToastProvider } from "../../../../shared/components/Toast";
import { ArchiveNoteList } from "../ArchiveNoteList";
import type { ArchiveSession } from "../../types";
import { enUS } from "date-fns/locale";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: vi.fn((props) => {
    const key = props.computeItemKey ? props.computeItemKey(0, { id: "test-note-id" }) : "none";
    return <div data-testid="mock-virtuoso" data-item-key={key} />;
  }),
  VirtuosoGrid: vi.fn((props) => {
    const key = props.computeItemKey ? props.computeItemKey(0, { id: "test-grid-id" }) : "none";
    return <div data-testid="mock-virtuoso-grid" data-item-key={key} />;
  }),
}));

describe("DEEP-15: ArchiveNoteList item keys", () => {
  const mockSessions: ArchiveSession[] = [
    {
      id: "session-1",
      userId: "u1",
      content: "Hello note 1",
      duration: 10,
      wordCount: 2,
      charCount: 12,
      wpm: 12,
      createdAt: Date.now(),
    },
  ];

  const defaultProps = {
    loading: false,
    error: null,
    groupedSessions: {},
    sortedDates: [],
    dateLocale: enUS,
    labels: [],
    userId: "u1",
    searchQuery: "",
    isGroupedByDate: false,
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onTagsChange: vi.fn(),
    onTitleChange: vi.fn(),
    onDateChange: vi.fn(),
    onLabelChange: vi.fn(),
    onStorageChange: vi.fn(),
    t: (k: string) => k,
    language: "en",
    entriesLabel: (n: number) => String(n),
  };

  it("passes computeItemKey with s.id to Virtuoso in list mode", () => {
    renderWithProviders(
      <ToastProvider>
        <ArchiveNoteList
          {...defaultProps}
          viewMode="list"
          filteredSessions={mockSessions}
        />
      </ToastProvider>
    );

    const el = screen.getByTestId("mock-virtuoso");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-item-key")).toBe("test-note-id");
  });

  it("passes computeItemKey with s.id to VirtuosoGrid in grid mode", () => {
    renderWithProviders(
      <ToastProvider>
        <ArchiveNoteList
          {...defaultProps}
          viewMode="grid"
          filteredSessions={mockSessions}
        />
      </ToastProvider>
    );

    const el = screen.getByTestId("mock-virtuoso-grid");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-item-key")).toBe("test-grid-id");
  });

  it("renders empty state with 'Write first note' action and clicking it navigates to '/' (AG-ONBOARD-4)", () => {
    mockNavigate.mockClear();
    renderWithProviders(
      <ToastProvider>
        <ArchiveNoteList
          {...defaultProps}
          viewMode="list"
          filteredSessions={[]}
        />
      </ToastProvider>
    );

    const actionBtn = screen.getByRole("button", { name: "archive_empty_action" });
    expect(actionBtn).toBeInTheDocument();

    fireEvent.click(actionBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
