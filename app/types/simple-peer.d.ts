declare module 'simple-peer' {
    import { Instance } from 'simple-peer';

    interface Options {
        initiator?: boolean;
        channelName?: string;
        channelConfig?: any;
        trickle?: boolean;
        stream?: MediaStream;
        offerConstraints?: any;
        answerConstraints?: any;
        sdpTransform?: (sdp: any) => any;
        config?: any;
    }

    class SimplePeer {
        constructor(opts?: Options);
        on(event: string, listener: (...args: any[]) => void): this;
        signal(data: any): void;
        destroy(err?: Error): void;
        // Add other methods as needed
    }

    export = SimplePeer;
}
