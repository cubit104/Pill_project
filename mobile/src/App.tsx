import { useEffect, useRef, useState } from "react";
import {
  HashRouter,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import OfflineBanner from "./components/OfflineBanner";
import TabBar from "./components/TabBar";
import { ToastProvider } from "./components/Toast";
import { BackStackProvider, useBackStack } from "./lib/backstack";
import {
  applyStatusBar,
  hideSplash,
  installKeyboardListeners,
  isNative,
} from "./lib/native";
import { clearBadge } from "./lib/reminders";
import { AccountProvider } from "./lib/account";
import { LangProvider } from "./lib/i18n";
import { SettingsProvider } from "./lib/settings";
import { isLegalKind } from "./content/legal";
import { parsePillPath } from "./lib/goals";
import { loadWelcomeSeen, saveLastTab, saveWelcomeSeen } from "./lib/storage";
import AboutScreen from "./screens/AboutScreen";
import AccountScreen from "./screens/AccountScreen";
import DoctorSheetScreen from "./screens/DoctorSheetScreen";
import TodayScreen from "./screens/TodayScreen";
import BottleScanScreen from "./screens/BottleScanScreen";
import CabinetScreen from "./screens/CabinetScreen";
import ContactScreen from "./screens/ContactScreen";
import EditorialScreen from "./screens/EditorialScreen";
import HomeScreen from "./screens/HomeScreen";
import IdentifyScreen from "./screens/IdentifyScreen";
import InteractionsScreen from "./screens/InteractionsScreen";
import LegalScreen from "./screens/LegalScreen";
import PillScreen from "./screens/PillScreen";
import RecentScreen from "./screens/RecentScreen";
import SearchScreen from "./screens/SearchScreen";
import SectionScreen from "./screens/SectionScreen";
import WelcomeScreen from "./screens/WelcomeScreen";

/** Native wiring that needs the router: back button, deep links, status bar, splash. */
function NativeBridges() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pop } = useBackStack();

  useEffect(() => {
    void hideSplash();
    void applyStatusBar("auto");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => void applyStatusBar("auto");
    mq.addEventListener("change", onTheme);
    const removeKeyboard = installKeyboardListeners();
    return () => {
      mq.removeEventListener("change", onTheme);
      removeKeyboard();
    };
  }, []);

  useEffect(() => {
    const root = location.pathname.split("/")[1];
    if (root) void saveLastTab(`/${root}`);
  }, [location.pathname]);

  // The icon badge means "a dose is waiting"; opening the app clears it.
  useEffect(() => {
    if (!isNative()) return;
    void clearBadge();
    const stateSub = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void clearBadge();
    });
    return () => {
      void stateSub.then((s) => s.remove());
    };
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    const backSub = CapApp.addListener("backButton", ({ canGoBack }) => {
      if (pop()) return;
      if (
        canGoBack &&
        window.history.length > 1 &&
        location.pathname !== "/home"
      ) {
        navigate(-1);
        return;
      }
      void CapApp.exitApp();
    });
    // pillseek.com/search?q=... and /identify links open the matching tab.
    const urlSub = CapApp.addListener("appUrlOpen", ({ url }) => {
      try {
        const u = new URL(url);
        if (u.pathname.startsWith("/search")) navigate(`/search${u.search}`);
        else if (u.pathname.startsWith("/identify")) navigate("/identify");
        else if (parsePillPath(u.pathname)) navigate(u.pathname);
        else if (u.pathname.startsWith("/interactions"))
          navigate(`/interactions${u.search}`);
        else if (u.pathname.startsWith("/editorial-team")) navigate(u.pathname);
        else if (u.pathname === "/contact") navigate("/contact");
        else if (u.pathname === "/privacy") navigate("/legal/privacy");
        else if (u.pathname === "/terms") navigate("/legal/terms");
        else if (u.pathname === "/medical-disclaimer")
          navigate("/legal/disclaimer");
      } catch {
        /* ignore malformed URLs */
      }
    });
    return () => {
      void backSub.then((s) => s.remove());
      void urlSub.then((s) => s.remove());
    };
  }, [navigate, pop, location.pathname]);

  return null;
}

const TABS = [
  "/home",
  "/identify",
  "/search",
  "/cabinet",
  "/recent",
  "/about",
] as const;
type Tab = (typeof TABS)[number];

function isTab(p: string): p is Tab {
  return (TABS as readonly string[]).includes(p);
}

/**
 * All tab panes stay mounted and are shown/hidden, so switching tabs never
 * cancels an identification in flight or throws away photos, results or a
 * search. Inactive tabs are `inert` so they take no focus or taps.
 */
function Shell() {
  const location = useLocation();
  const { pathname } = location;
  // First launch: welcome + camera ask, once.
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    void loadWelcomeSeen().then((seen) => !seen && setWelcome(true));
  }, []);
  const finishWelcome = () => {
    setWelcome(false);
    void saveWelcomeSeen();
  };
  // Remember which tab is underneath while a pill page is pushed on top.
  const lastTab = useRef<Tab>("/home");
  if (isTab(pathname)) lastTab.current = pathname;
  const pillRoute = parsePillPath(pathname);
  const interactions = pathname === "/interactions";
  const editorial =
    pathname === "/editorial-team" || pathname.startsWith("/editorial-team/");
  const editorialSlug = pathname.startsWith("/editorial-team/")
    ? decodeURIComponent(pathname.slice("/editorial-team/".length)) || null
    : null;
  const legalKind = pathname.startsWith("/legal/")
    ? pathname.slice("/legal/".length)
    : null;
  const legal = isLegalKind(legalKind) ? legalKind : null;
  const contact = pathname === "/contact";
  const accountPage = pathname === "/account";
  const doctorSheet = pathname === "/doctor-sheet";
  const today = pathname === "/today";
  const scanBottle = pathname === "/scan-bottle";
  // Anything pushed over the tabs: the tab panes hide and go inert underneath.
  const overlay =
    pillRoute !== null ||
    interactions ||
    editorial ||
    legal !== null ||
    contact ||
    accountPage ||
    doctorSheet ||
    today ||
    scanBottle;
  if (!isTab(pathname) && !overlay) return <Navigate to="/home" replace />;
  const active: Tab = isTab(pathname) ? pathname : lastTab.current;
  const panes: Array<[Tab, React.ReactNode]> = [
    // A tab counts as active only while it is actually on screen (not under a pill page),
    // so its URL syncing and reloads pause while the pill page owns the URL.
    [
      "/home",
      <HomeScreen key="home" active={active === "/home" && !overlay} />,
    ],
    [
      "/identify",
      <IdentifyScreen
        key="identify"
        active={active === "/identify" && !overlay}
      />,
    ],
    [
      "/search",
      <SearchScreen key="search" active={active === "/search" && !overlay} />,
    ],
    [
      "/cabinet",
      <CabinetScreen
        key="cabinet"
        active={active === "/cabinet" && !overlay}
      />,
    ],
    [
      "/recent",
      <RecentScreen key="recent" active={active === "/recent" && !overlay} />,
    ],
    [
      "/about",
      <AboutScreen key="about" active={active === "/about" && !overlay} />,
    ],
  ];
  return (
    <div className="app-shell flex h-full flex-col bg-canvas">
      <OfflineBanner />
      <div className="relative min-h-0 flex-1">
        {panes.map(([tab, node]) => (
          <div
            key={tab}
            className="h-full"
            hidden={tab !== active || overlay}
            inert={tab !== active || overlay ? true : undefined}
          >
            {node}
          </div>
        ))}
        {interactions && (
          <div className="absolute inset-0 z-30">
            <InteractionsScreen key={location.search} />
          </div>
        )}
        {editorial && (
          <div className="absolute inset-0 z-30">
            <EditorialScreen slug={editorialSlug} />
          </div>
        )}
        {legal && (
          <div className="absolute inset-0 z-30">
            <LegalScreen kind={legal} />
          </div>
        )}
        {contact && (
          <div className="absolute inset-0 z-30">
            <ContactScreen />
          </div>
        )}
        {accountPage && (
          <div className="absolute inset-0 z-30">
            <AccountScreen />
          </div>
        )}
        {doctorSheet && (
          <div className="absolute inset-0 z-30">
            <DoctorSheetScreen />
          </div>
        )}
        {today && (
          <div className="absolute inset-0 z-30">
            <TodayScreen />
          </div>
        )}
        {scanBottle && (
          <div className="absolute inset-0 z-30">
            <BottleScanScreen />
          </div>
        )}
        {pillRoute && (
          <div className="absolute inset-0 z-30">
            {pillRoute.section ? (
              <SectionScreen
                key={`section:${pillRoute.slug}`}
                slug={pillRoute.slug}
                section={pillRoute.section}
              />
            ) : (
              <PillScreen key={pillRoute.slug} slug={pillRoute.slug} />
            )}
          </div>
        )}
      </div>
      <TabBar />
      {welcome && (
        <div className="fixed inset-0 z-50">
          <WelcomeScreen onDone={finishWelcome} />
        </div>
      )}
      <NativeBridges />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <BackStackProvider>
        <SettingsProvider>
          <LangProvider>
            <ToastProvider>
              <AccountProvider>
                <Shell />
              </AccountProvider>
            </ToastProvider>
          </LangProvider>
        </SettingsProvider>
      </BackStackProvider>
    </HashRouter>
  );
}
