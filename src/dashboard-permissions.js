export const DASHBOARD_DEFAULTS={stock:true,near:true,delivery:true,finance:false};
export const dashboardPermissions=(role,saved)=>role==='admin'?{stock:true,near:true,delivery:true,finance:true}:{...DASHBOARD_DEFAULTS,...Object.fromEntries(Object.entries(saved||{}).filter(([k,v])=>k in DASHBOARD_DEFAULTS&&typeof v==='boolean'))};
export function dashboardProjection(payload,permissions){
 return {...payload,permissions,rows:permissions.stock?payload.rows:[],machines:permissions.stock||permissions.near||permissions.delivery||permissions.finance?payload.machines:[],total_value:permissions.finance?payload.total_value:null,can_view_prices:permissions.finance,analytics:payload.analytics?{...payload.analytics,near:permissions.near?payload.analytics.near:[],deliveries:permissions.delivery?payload.analytics.deliveries:[],inventory:permissions.finance?payload.analytics.inventory:null,purchase_total:permissions.finance?payload.analytics.purchase_total:null}:null};
}
