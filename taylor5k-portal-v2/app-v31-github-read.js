V31_TOOL_LABELS.list_github_project_files='Taylor Folders';
V31_TOOL_LABELS.read_github_project_file='Taylor Asset';
const realtimeV31ToolsGithubRead=realtimeV31Tools;
realtimeV31Tools=function(){
  const xs=realtimeV31ToolsGithubRead();
  const extra=[
    {type:'function',name:'list_github_project_files',description:'List Taylor 5K project files and folders stored in GitHub under taylor5k-assets, taylor5k-preview, or taylor5k-portal-v2.',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
    {type:'function',name:'read_github_project_file',description:'Open a Taylor 5K GitHub project asset or file, including images and source files.',parameters:{type:'object',properties:{path:{type:'string'},query:{type:['string','null']}},required:['path','query'],additionalProperties:false}}
  ];
  const at=Math.max(0,xs.findIndex(x=>x.name==='propose_project_update'));
  xs.splice(at,0,...extra);return xs;
};
const rtV31InstructionsGithubRead=rtV31Instructions;
rtV31Instructions=function(){return rtV31InstructionsGithubRead()+`\nTaylor GitHub folders are live project sources too. Use list_github_project_files and read_github_project_file when the user asks about logos, photos, assets, site files, portal files, or anything in the Taylor folders.`};
