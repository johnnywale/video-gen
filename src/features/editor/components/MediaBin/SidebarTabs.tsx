import styles from "./SidebarTabs.module.css";

export type TabId = "media" | "audio" | "text" | "effects" | "transitions" | "filters";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: "media", label: "Media", icon: "\uD83C\uDFAC" },
  { id: "audio", label: "Audio", icon: "\uD83D\uDD0A" },
  { id: "text", label: "Text", icon: "T" },
  { id: "effects", label: "FX", icon: "\u2726" },
  { id: "transitions", label: "Trans", icon: "\u21C4" },
  { id: "filters", label: "Filters", icon: "\u25D0" },
];

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function SidebarTabs({ activeTab, onTabChange }: Props) {
  return (
    <div className={styles.sidebar}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
          onClick={() => onTabChange(tab.id)}
          title={tab.label}
          aria-label={tab.label}
        >
          <span className={styles.tabIcon}>{tab.icon}</span>
          <span className={styles.tabLabel}>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
