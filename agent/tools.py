TOOLS = [{"type":"function","function":{"name": name, "description": description,
    "parameters":{"type":"object","properties": properties,"required": required}}}
    for name, description, properties, required in [
        ("create_case","Persist a validated case",{"case":{"type":"object"}},["case"]),
        ("compute_deadlines","Calculate configured compliance deadlines",{"case_id":{"type":"string"}},["case_id"]),
        ("schedule_job","Schedule a case",{"case_id":{"type":"string"}},["case_id"]),
        ("request_approval","Request human approval",{"case_id":{"type":"string"},"action":{"type":"string"}},["case_id","action"]),
        ("notify_resident","Notify a resident",{"case_id":{"type":"string"},"message":{"type":"string"}},["case_id","message"]),
        ("escalate","Escalate a case",{"case_id":{"type":"string"},"reason":{"type":"string"}},["case_id","reason"]),
    ]]
