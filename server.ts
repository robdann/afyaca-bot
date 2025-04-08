import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import {
  StateGraph,
  MessagesAnnotation,
  END,
  START
} from "@langchain/langgraph";
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatGroq } from "@langchain/groq";
import { z } from 'zod';
import { HumanMessage } from "@langchain/core/messages";
import { tool } from '@langchain/core/tools';
import { MemorySaver } from "@langchain/langgraph";

// Here we only save in-memory
const memory = new MemorySaver();

const packages = tool(async () =>  {
  const response = await fetch("https://app.doc.co.tz/api/guest/profile");
  const json = await response.json();  
  return "" + JSON.stringify(json.deployment.packages); 
}, {
  name: "get_packages",
  description: "Get a list of appointment types",
  schema: z.object({
        noOp: z.string().optional().describe("No args")
    })
});
const bookappointment = tool(async (input) =>  {
  console.log(input);
  const response = await fetch("https://app.doc.co.tz/api/guest/appointments", {body: JSON.stringify(input
), method: "POST"});
  console.log(response.status)
  const json = await response.json();  
  return "" + JSON.stringify(json); 
}, {
  name: "book_appointment",
  description: "book an appointment with a doctor",
  schema: z.object({
         patient: z.object({
             firstName: z.string().describe("the patient's first name"),
             lastName: z.string().describe("the patient's last name"),
             dateOfBirth: z.string().describe("the patient's date of birth"),
         }),        
         reason: z.string().describe("the reason why the user wants to see the doctor"),
         dateTime: z.string().describe("The date and time of the appointment"),
    })
});

const appointments = tool(async () =>  {
  const response = await fetch("https://app.doc.co.tz/api/guest/doctors/availability/1546510");
  const json = await response.json();  
  return "" + JSON.stringify(json); 
}, {
  name: "get_appointment_dates",
  description: "get a list of available appointment times",
  schema: z.object({
        noOp: z.string().optional().describe("No args")
    })
});

const tools = [packages, appointments, bookappointment];
const modelWithTools = new ChatGroq({
  model: "llama-3.3-70b-versatile",
  temperature: 0
}).bindTools(tools);


const toolNodeForGraph = new ToolNode(tools)

const shouldContinue = (state: typeof MessagesAnnotation.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls?.length) {
      console.log("tools");
      return "tools";
  }
  return END;
}

const callModel = async (state: typeof MessagesAnnotation.State) => {
  const { messages } = state;
  const response = await modelWithTools.invoke(messages);
  return { messages: response };
}


const workflow = new StateGraph(MessagesAnnotation)
  // Define the two nodes we will cycle between
  .addNode("agent", callModel)
  .addNode("tools", toolNodeForGraph)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, ["tools", END])
  .addEdge("tools", "agent");

const app = workflow.compile({ checkpointer: memory });

const printoutput = async stream => {
for await (const chunk of stream) {
  const lastMessage = chunk.messages[chunk.messages.length - 1];
  const content = lastMessage.content;
  console.dir({
    content,
  }, { depth: null });
}
}
let stream = await app.stream(
  {
    messages: [

{ role: "system", content: "you are a telemedicine appointment booking agent. you cannot give medical advice. dates and times should be displayed in a human readable format. appointments need the name and date of birth of the patient, plus optionally any medical conditions they might have." },
{ role: "user", content: "i would like to book an appointment" },

],
  },
  {
    configurable: { thread_id: "testing"},
    streamMode: "values"
  }
)
await printoutput(stream);
const rl = readline.createInterface({
  input: stdin,
  output: stdout
});
while(true) {
let cmd = await rl.question(":");
if (cmd === 'exit'){
    break;
}
stream = await app.stream({messages: [{role: "user", content: cmd}]}, {configurable: { thread_id: "testing"}, streamMode: "values"})
await printoutput(stream);
}
console.log("done");

