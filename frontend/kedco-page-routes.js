/*
============================================================
KEDCO TECHNICAL AUTOMATION
FRONTEND PAGE ROUTE MANIFEST
============================================================
*/

window.KEDCO_PAGE_ROUTES = {

  // Executive
  CTO:
    "./pages/executive/cto.html",

  SUPER_ADMIN:
    "./pages/developer/dev.html",

  DEVELOPER:
    "./pages/developer/dev.html",

  MD_CEO:
    "./pages/executive/cto.html",

  HEAD_TECHNICAL:
    "./pages/executive/cto.html",

  TA_CTO:
    "./pages/executive/ta.html",


  // System Operations
  HEAD_SO:
    "./pages/system-operations/headso.html",

  SUPERVISOR:
    "./pages/system-operations/supervisors.html",

  SUPER_OPERATOR:
    "./pages/system-operations/super_operator.html",

  DISPATCH_SUPERVISOR:
    "./pages/system-operations/dispatch.html",

  DISPATCH:
    "./pages/system-operations/dispatch.html",

  OPERATOR:
    "./pages/system-operations/operator.html",

  TCN_INTERFACE:
    "./pages/system-operations/operator.html",

  STATION_OPERATOR:
    "./pages/system-operations/operator.html",


  // Operations & Maintenance
  HEAD_OM:
    "./pages/operations-maintenance/headom.html",

  REGIONAL_OM_COORD:
    "./pages/operations-maintenance/headom.html",

  TSP_TECH_SERVICES:
    "./pages/operations-maintenance/headom.html",

  REGIONAL_EF_LEAD:
    "./pages/operations-maintenance/regionalef.html",

  REGIONAL_CJ_LEAD:
    "./pages/operations-maintenance/regionalcj.html",

  REGIONAL_EF:
    "./pages/operations-maintenance/regionalef.html",

  REGIONAL_CJ:
    "./pages/operations-maintenance/regionalcj.html",

  RE:
    "./pages/operations-maintenance/re_te.html",

  TE:
    "./pages/operations-maintenance/re_te.html",

  SUPER_RE_TE:
    "./pages/operations-maintenance/super_re_te.html",


  // Protection Control & Metering
  HEAD_PCM:
    "./pages/pcm/headpcm.html",

  REGIONAL_PCM_COORD:
    "./pages/pcm/regionalpcm.html",

  PROTECTION_ENGINEER:
    "./pages/pcm/regionalpcm.html",

  CONTROL_SCADA_ENGINEER:
    "./pages/pcm/regionalpcm.html",

  METERING_ENGINEER:
    "./pages/pcm/regionalpcm.html",

  TEST_ENGINEER:
    "./pages/pcm/regionalpcm.html",

  REGIONAL_PPM_COORD:
    "./pages/pcm/regionalpcm.html",


  // Planning & Investment
  HEAD_PI:
    "./pages/planning-investment/headpi.html",

  REGIONAL_PI_COORD:
    "./pages/planning-investment/regionalpi.html",

  PLANNING_ENGINEER:
    "./pages/planning-investment/regionalpi.html",

  PROJECT_ENGINEER:
    "./pages/planning-investment/regionalpi.html",


  // HSE
  HEAD_HSE:
    "./pages/hse/headhse.html",

  REGIONAL_HSE_OFFICER:
    "./pages/hse/regionalhse.html",

  HSE_OFFICER:
    "./pages/hse/regionalhse.html",


  // MIS
  HEAD_MIS:
    "./pages/mis/mis.html",

  MIS_TEAM_LEAD:
    "./pages/mis/teamleaddata.html",

  DATA_ANALYST:
    "./pages/mis/teamleaddata.html",

  PROCUREMENT_HEAD:
    "./pages/executive/ta.html",

  PROCUREMENT_OFFICER:
    "./pages/executive/ta.html",

  FINANCE_HEAD:
    "./pages/executive/ta.html",

  FINANCE_OFFICER:
    "./pages/executive/ta.html",

  LEGAL_OFFICER:
    "./pages/executive/ta.html",

  SECURITY_OFFICER:
    "./pages/executive/ta.html",

  HR_ADMIN_OFFICER:
    "./pages/executive/ta.html",


  // TMO / Analytics
  TMO:
    "./pages/tmo/tmo.html",

  ANALYZER:
    "./pages/tmo/analyzer.html",

  TRANSMISSION:
    "./pages/tmo/trans.html",

  SUPER_TRANS:
    "./pages/tmo/super_trans.html",


  // Stores
  STORE_MANAGER:
    "./pages/stores/store-inventory.html",

  STORE_OFFICER:
    "./pages/stores/store-inventory.html",


  // Contractors
  CONTRACTOR_PM:
    "./pages/contractors/contractors.html",

  CONTRACTOR_USER:
    "./pages/contractors/contractors.html"

};

// Approved account directory. Shared emails intentionally carry multiple
// roles; the backend returns the primary role for automatic routing.
window.KEDCO_USER_DIRECTORY = {
  "cto@kedco.com": ["CTO"],
  "mdceo@kedco.com": ["MD_CEO"],
  "headtechnical@kedco.com": ["HEAD_TECHNICAL"],
  "yajibsoftware@gmail.com": ["SUPER_ADMIN"],
  "tacto@kedco.com": ["TA_CTO"],
  "procurementhead@kedco.com": ["PROCUREMENT_HEAD"],
  "procurementofficer@kedco.com": ["PROCUREMENT_OFFICER"],
  "financehead@kedco.com": ["FINANCE_HEAD"],
  "financeofficer@kedco.com": ["FINANCE_OFFICER"],
  "legalofficer@kedco.com": ["LEGAL_OFFICER"],
  "securityofficer@kedco.com": ["SECURITY_OFFICER"],
  "hradminofficer@kedco.com": ["HR_ADMIN_OFFICER"],
  "headso@kedco.com": ["HEAD_SO"],
  "dispatch@kedco.com": ["DISPATCH_SUPERVISOR", "DISPATCH"],
  "operator@kedco.com": ["OPERATOR", "STATION_OPERATOR"],
  "tcninterface@kedco.com": ["TCN_INTERFACE"],
  "headom@kedco.com": ["HEAD_OM"],
  "regionalomcoord@kedco.com": ["REGIONAL_OM_COORD"],
  "tsptechnicalservices@kedco.com": ["TSP_TECH_SERVICES"],
  "regionaleflead@kedco.com": ["REGIONAL_EF_LEAD"],
  "regionalef@kedco.com": ["REGIONAL_EF"],
  "regionalcjlead@kedco.com": ["REGIONAL_CJ_LEAD"],
  "regionalcj@kedco.com": ["REGIONAL_CJ"],
  "re@kedco.com": ["RE"],
  "te@kedco.com": ["TE"],
  "headpcm@kedco.com": ["HEAD_PCM"],
  "regionalpcmcoord@kedco.com": ["REGIONAL_PCM_COORD"],
  "protectionengineer@kedco.com": ["PROTECTION_ENGINEER"],
  "controlscadaengineer@kedco.com": ["CONTROL_SCADA_ENGINEER"],
  "meteringengineer@kedco.com": ["METERING_ENGINEER"],
  "testengineer@kedco.com": ["TEST_ENGINEER"],
  "regionalppmcoord@kedco.com": ["REGIONAL_PPM_COORD"],
  "headpi@kedco.com": ["HEAD_PI"],
  "regionalpicoord@kedco.com": ["REGIONAL_PI_COORD"],
  "planningengineer@kedco.com": ["PLANNING_ENGINEER"],
  "projectengineer@kedco.com": ["PROJECT_ENGINEER"],
  "headhse@kedco.com": ["HEAD_HSE"],
  "regionalhseofficer@kedco.com": ["REGIONAL_HSE_OFFICER"],
  "hseofficer@kedco.com": ["HSE_OFFICER"],
  "mis@kedco.com": ["HEAD_MIS"],
  "datateamlead@kedco.com": ["MIS_TEAM_LEAD"],
  "dataanalyst@kedco.com": ["DATA_ANALYST", "ANALYZER"],
  "tmo@kedco.com": ["TMO"],
  "trans@kedco.com": ["TRANSMISSION"],
  "storemanager@kedco.com": ["STORE_MANAGER"],
  "storeofficer@kedco.com": ["STORE_OFFICER"],
  "contractorpm@kedco.com": ["CONTRACTOR_PM"],
  "contractoruser@kedco.com": ["CONTRACTOR_USER"]
};


// Preferred landing roles for multi-role accounts.
// The user keeps every assigned role and can switch after login.
window.KEDCO_LOGIN_LANDING_ROLE = {
  "dataanalyst@kedco.com": "ANALYZER"
};
